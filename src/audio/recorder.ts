/**
 * Captures a stretch of the live stage source so it can be replayed verbatim.
 *
 * Tuning against a live stream is not measurable: every run hears different
 * material, and the same code measured beat lock at 0.22, 0.28, 0.61 and 0.71
 * across passages of one track. Recording once and replaying that recording
 * turns the audio into a fixed input, which is the prerequisite for telling a
 * real improvement from a lucky passage.
 *
 * The clip lives in IndexedDB rather than on disk: it survives reloads, stays
 * inside the browser profile, and never risks a copyrighted recording being
 * committed to the repository.
 */
const DB_NAME = 'voice-runner-dev';
const STORE = 'tracks';
const KEY = 'stage-clip';

export interface RecordedTrack {
  blob: Blob;
  seconds: number;
  recordedAt: number;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = (): void => {
      request.result.createObjectStore(STORE);
    };
    request.onsuccess = (): void => {
      resolve(request.result);
    };
    request.onerror = (): void => {
      reject(new Error('Could not open the dev track store'));
    };
  });
}

/** Records `seconds` of `stream` and resolves once the recorder has flushed. */
export function recordStream(stream: MediaStream, seconds: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const audioOnly = new MediaStream(stream.getAudioTracks());
    if (audioOnly.getAudioTracks().length === 0) {
      reject(new Error('The stage source has no audio track to record.'));
      return;
    }

    const recorder = new MediaRecorder(audioOnly);
    const chunks: Blob[] = [];
    recorder.ondataavailable = (event): void => {
      if (event.data.size > 0) chunks.push(event.data);
    };
    recorder.onstop = (): void => {
      resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    recorder.onerror = (): void => {
      reject(new Error('Recording failed'));
    };

    recorder.start();
    setTimeout(() => {
      if (recorder.state !== 'inactive') recorder.stop();
    }, seconds * 1000);
  });
}

export async function saveTrack(track: RecordedTrack): Promise<void> {
  const db = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(track, KEY);
    tx.oncomplete = (): void => {
      resolve();
    };
    tx.onerror = (): void => {
      reject(new Error('Could not save the dev track'));
    };
  });
  db.close();
}

export async function loadTrack(): Promise<RecordedTrack | null> {
  const db = await openDatabase();
  const track = await new Promise<RecordedTrack | null>((resolve, reject) => {
    const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
    request.onsuccess = (): void => {
      resolve((request.result as RecordedTrack | undefined) ?? null);
    };
    request.onerror = (): void => {
      reject(new Error('Could not read the dev track'));
    };
  });
  db.close();
  return track;
}
