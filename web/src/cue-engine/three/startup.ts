/** Tracks work applied to this canvas, including React effect replacements. */
export class SceneStartup {
  pending = 0;
  revision = 0;
  released = false;

  begin() {
    if (this.released) return () => {};
    this.pending++;
    this.revision++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      this.pending--;
      this.revision++;
    };
  }

  current(revision: number) {
    return !this.released && this.pending === 0 && this.revision === revision;
  }
}

/** Wait for complete frames after compilation, including shadows and texture uploads. */
export async function prepareSceneStartup(
  startup: SceneStartup,
  compile: () => Promise<unknown>,
  nextFrame: () => Promise<void>,
  finishGpu: () => void,
  alive: () => boolean,
) {
  const revision = startup.revision;
  const valid = () => alive() && startup.current(revision);
  if (!valid()) return false;
  await compile();
  if (!valid()) return false;
  for (let i = 0; i < 3; i++) {
    await nextFrame();
    if (!valid()) return false;
  }
  // Synchronize once while covered; never stall the GPU during camera playback.
  finishGpu();
  await nextFrame();
  return valid();
}
