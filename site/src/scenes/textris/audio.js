/**
 * Music and sound effects for Textris.
 *
 * Music runs through a TrackController, which is always on the engine's WSOLA
 * time-stretch path — so the danger-zone speed-up changes tempo without
 * changing pitch. A `transitionBuffer` gives the stretcher enough pre-roll to
 * hide the seam when the rate changes mid-playback.
 *
 * Sound effects use the plain AudioPlayer path instead: it resamples (speed
 * and pitch are coupled there), which is irrelevant for one-shots and avoids
 * spinning up a worklet per blip.
 */

const Omosuen = window.Omosuen;

/** Scene modules load from `<base>/scenes/textris/`, assets from `<base>/assets/`. */
const ASSETS = new URL('../../assets/textris/', import.meta.url).href;

const MUSIC = { theme: 'music/music-1.mp3', ending: 'music/ending.mp3' };
const SFX = {
  move: 'sfx/move.mp3',
  rotate: 'sfx/rotate.mp3',
  lock: 'sfx/lock.mp3',
  lineClear: 'sfx/line-clear.mp3',
  tetris: 'sfx/tetris.mp3',
  levelUp: 'sfx/level-up.mp3',
};

/** Tempo multiplier while the stack is in the danger zone. */
const DANGER_SPEED = 1.25;

export async function createAudio(scene) {
  const tracks = {};
  // Every audio-track must be attached under the scene root BEFORE the
  // audio-player initialises: the player discovers and decodes tracks by
  // walking up to the root, and anything added later is never loaded.
  for (const [name, path] of Object.entries({ ...MUSIC, ...SFX })) {
    tracks[name] = await Omosuen.newComponent(
      'audio-track',
      { name: `textris-${name}`, filePath: ASSETS + path },
      scene,
    );
  }

  const musicEffect = await Omosuen.newComponent(
    'audio-effect',
    {
      name: 'Textris Music FX',
      volume: 0.5,
      speedShift: 1.0,
      transitionBuffer: 150,
    },
    scene,
  );
  const sfxEffect = await Omosuen.newComponent(
    'audio-effect',
    { name: 'Textris SFX', volume: 0.7 },
    scene,
  );

  const player = await Omosuen.newComponent(
    'audio-player',
    { name: 'Textris Audio', masterVolume: 1.0, muted: false },
    scene,
  );

  let theme = null;
  let ending = null;
  let danger = false;
  let started = false;

  /**
   * The player's init is async and runs off the engine's init queue, so this
   * is polled from the game tick rather than awaited — `createScene` can run
   * before the loop that would drain that queue.
   */
  function ready() {
    return (
      Boolean(player._audioContext) &&
      player._bufferCache.has(tracks.theme.filePath)
    );
  }

  return {
    ready,

    /** Resumes the AudioContext; browsers start it suspended until a gesture. */
    unlock() {
      const ctx = player._audioContext;
      if (ctx && ctx.state === 'suspended') ctx.resume();
    },

    /** Starts the theme looping. Safe to call every frame; only acts once. */
    startMusic() {
      if (started || !ready()) return;
      started = true;
      theme = new Omosuen.TrackController(
        player,
        tracks.theme,
        musicEffect,
        true,
      );
      ending = new Omosuen.TrackController(
        player,
        tracks.ending,
        musicEffect,
        false,
      );
      theme.play();
    },

    /** Danger zone: the stack is within a few rows of the top. */
    setDanger(value) {
      if (value === danger || !theme) return;
      danger = value;
      theme.speedShift = value ? DANGER_SPEED : 1.0;
    },

    gameOver() {
      if (!theme) return;
      theme.stop();
      danger = false;
      theme.speedShift = 1.0;
      ending.play();
    },

    restart() {
      if (!theme) return;
      ending.stop();
      theme.stop();
      theme.play();
    },

    sfx(name) {
      const track = tracks[name];
      if (!track || !ready()) return;
      player.play(track, false, sfxEffect);
    },
  };
}
