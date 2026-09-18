import type { AttachedAudioSource, AudioSourceProvider } from './types';

/**
 * A track the player supplies, played back by the game itself.
 *
 * This is the only source that is identical on every platform, which makes it
 * the one to use for tuning the generator and for automated runs — the same
 * file must always produce the same stage.
 */
export function createFileSource(file: Blob, label = 'Local track'): AudioSourceProvider {
  return {
    descriptor: { kind: 'file', label },

    isSupported(): boolean {
      return true;
    },

    async attach(context: AudioContext): Promise<AttachedAudioSource> {
      const buffer = await context.decodeAudioData(await file.arrayBuffer());
      const node = context.createBufferSource();
      node.buffer = buffer;
      node.loop = true;

      // Unlike the capture sources, this one is also audible: the player hears
      // the track through the game, so it must reach the destination too.
      const gain = context.createGain();
      node.connect(gain).connect(context.destination);

      if (context.state === 'suspended') await context.resume();
      node.start();

      return {
        descriptor: { kind: 'file', label },
        node,
        detach() {
          node.stop();
          node.disconnect();
          gain.disconnect();
        },
      };
    },
  };
}
