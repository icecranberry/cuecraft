/** Keep lettering independent of the ordinary AI design draft. */
export function letteringRequest(text: string, style: string) {
  return {
    subject: `设计用于台球杆的文字纹样。文字内容：${JSON.stringify(text.trim())}。完整、准确呈现原文，保留字序与大小写，不翻译、不增删、不出现错别字；文字清晰可辨，作为图案主体。`,
    style: style.trim(),
    palette: '',
    keep: '指定的文字内容与文字风格',
    avoid: '额外文字、水印、无关标志'
  };
}
