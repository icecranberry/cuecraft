"""球杆业务无需外部服务即可验证的输入与协议契约。"""

import base64
import io
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from PIL import Image

from yuxi.services import cue_ai_service
from yuxi.services.builtin_cues import BUILTIN_BLANK_ASSETS, builtin_blank_asset_views
from yuxi.services.cue_legacy_import import _read_bundle
from yuxi.services.cue_proposal_service import _segment_geometry
from yuxi.services.cue_service import validate_blank_spec, validate_design_snapshot


def _png() -> bytes:
    output = io.BytesIO()
    Image.new("RGB", (512, 512), "blue").save(output, format="PNG")
    return output.getvalue()


def test_builtin_blank_catalog_models_are_continuous_and_have_expected_part_counts():
    for asset in BUILTIN_BLANK_ASSETS:
        validate_blank_spec(asset["specification"])

    assert len(BUILTIN_BLANK_ASSETS[0]["specification"]["display_parts"]) == 11
    assert [len(asset["specification"]["display_parts"]) for asset in BUILTIN_BLANK_ASSETS[1:]] == [2, 2, 3]
    catalog_ids = [asset["id"] for asset in builtin_blank_asset_views("blank")]
    assert catalog_ids == [asset["id"] for asset in BUILTIN_BLANK_ASSETS]
    assert builtin_blank_asset_views("pattern") == []


@pytest.mark.asyncio
async def test_design_snapshot_accepts_builtin_blank_without_database_row():
    await validate_design_snapshot(
        db=SimpleNamespace(),
        snapshot={"blankAssetId": BUILTIN_BLANK_ASSETS[1]["id"], "partOverrides": {}, "stickers": []},
    )


@pytest.mark.asyncio
async def test_design_snapshot_accepts_bundled_pattern_without_database_row():
    await validate_design_snapshot(
        db=SimpleNamespace(),
        snapshot={
            "partOverrides": {},
            "stickers": [{"assetId": "builtin-jade-spear"}],
        },
    )


@pytest.mark.asyncio
async def test_design_snapshot_rejects_unknown_bundled_pattern_id():
    async def missing_asset(_model, _asset_id):
        return None

    with pytest.raises(HTTPException) as caught:
        await validate_design_snapshot(
            db=SimpleNamespace(get=missing_asset),
            snapshot={
                "partOverrides": {},
                "stickers": [{"assetId": "builtin-not-in-catalog"}],
            },
        )
    assert caught.value.status_code == 422
    assert caught.value.detail == "图层引用了不存在的纹样或包裹素材"


@pytest.mark.asyncio
async def test_cue_chat_uses_configured_default_chat_model_and_design_context(monkeypatch):
    payloads = []

    async def default_options(_db):
        return {"default_model": "provider:cue-chat"}

    async def post_json(_url, _key, payload, _headers):
        payloads.append(payload)
        return {"choices": [{"message": {"content": "建议使用枫木与深绿握把。"}}]}

    model = SimpleNamespace(
        model_type="chat",
        api_key="test-only",
        base_url="https://chat.example/v1",
        model_id="cue-chat",
        headers={},
        request_body_overrides={"thinking": {"type": "disabled"}},
    )
    monkeypatch.setattr(cue_ai_service, "system_options", SimpleNamespace(get=default_options))
    monkeypatch.setattr(cue_ai_service.model_cache, "get_model_info", lambda _spec: model)
    monkeypatch.setattr(cue_ai_service, "_post_json", post_json)

    result = await cue_ai_service.run_cue_chat(
        db=None,
        messages=[{"role": "user", "content": "帮我搭配握把颜色"}],
        context={"cue_name": "我的球杆", "cue_type": "大头杆", "part_name": "握把", "part_length_mm": 202},
    )

    assert result == {"message": "建议使用枫木与深绿握把。"}
    assert payloads[0]["thinking"] == {"type": "disabled"}
    assert "当前部位：握把，长度 202 mm" in payloads[0]["messages"][0]["content"]
    assert payloads[0]["messages"][-1] == {"role": "user", "content": "帮我搭配握把颜色"}


@pytest.mark.asyncio
async def test_blank_chat_model_uses_yuxi_request_overrides(monkeypatch):
    payloads = []

    async def response(_url, _key, payload, _headers):
        payloads.append(payload)
        return {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(
                            {
                                "segments": [
                                    {
                                        "id": "shaft",
                                        "kind": "shaft",
                                        "name": "前支",
                                        "a0": 0,
                                        "a1": 1474,
                                        "r0": 6.5,
                                        "r1": 15,
                                        "matPreset": "maple",
                                        "printEnabled": True,
                                    }
                                ]
                            }
                        )
                    }
                }
            ]
        }

    monkeypatch.setattr(cue_ai_service, "_post_json", response)
    model = SimpleNamespace(
        base_url="https://api.deepseek.com",
        model_id="deepseek-flash",
        api_key="test-only",
        headers={},
        request_body_overrides={"thinking": {"type": "disabled"}},
    )
    result = await cue_ai_service._generate_blank_spec(model, "枫木球杆")
    assert result["size_status"] == "AI 尺寸草案"
    assert payloads[0]["thinking"] == {"type": "disabled"}


@pytest.mark.asyncio
async def test_chat_image_relay_markdown_data_url(monkeypatch):
    image = _png()

    async def response(*_args, **_kwargs):
        encoded = base64.b64encode(image).decode("ascii")
        return {"choices": [{"message": {"content": f"![image_1](data:image/png;base64,{encoded})"}}]}

    monkeypatch.setattr(cue_ai_service, "_post_json", response)
    model = SimpleNamespace(
        base_url="https://aikun.uk/v1/chat/completions",
        model_id="gpt-image-2.5-flare",
        api_key="test-only",
        headers={},
    )
    assert await cue_ai_service._generate_image(model, "蓝色几何纹样") == image


@pytest.mark.asyncio
async def test_chat_image_relay_sends_selected_reference(monkeypatch):
    image = _png()
    payloads = []

    async def response(_url, _key, payload, _headers):
        payloads.append(payload)
        return {"data": [{"b64_json": base64.b64encode(image).decode("ascii")}]}

    monkeypatch.setattr(cue_ai_service, "_post_json", response)
    model = SimpleNamespace(
        base_url="https://aikun.uk/v1/chat/completions",
        model_id="gpt-image-2.5-flare",
        api_key="test-only",
        headers={},
    )
    assert await cue_ai_service._generate_image(model, "参考木纹", ("image/png", image)) == image
    content = payloads[0]["messages"][0]["content"]
    assert content[0] == {"type": "text", "text": "参考木纹"}
    assert content[1]["image_url"]["url"].startswith("data:image/png;base64,")


def test_blank_segments_must_be_contiguous():
    validate_blank_spec({"segments": [{"a0": 0, "a1": 700, "r0": 6, "r1": 10}]})
    with pytest.raises(HTTPException) as caught:
        validate_blank_spec({"segments": [{"a0": 5, "a1": 700, "r0": 6, "r1": 10}]})
    assert caught.value.status_code == 422


def test_proposal_segment_geometry_uses_catalog_dimensions():
    custom = {"segments": [{"id": "grip", "a0": 1120, "a1": 1320, "r0": 13, "r1": 15}]}
    assert _segment_geometry(custom, "grip") == (1120, 1320, 13, 15)
    assert _segment_geometry(custom, "butt-cap") is None


def test_legacy_bundle_rejects_duplicate_ids():
    bundle = {"format": "cuecraft-legacy-v1", "assets": [{"legacy_id": "x"}, {"legacy_id": "x"}], "works": []}
    with pytest.raises(HTTPException) as caught:
        _read_bundle(json.dumps(bundle).encode())
    assert caught.value.status_code == 422
