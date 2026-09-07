import { runNoteAutopost } from './_note-lib.mjs';

export default async () => {
  try {
    const result = await runNoteAutopost();
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(String(err?.stack || err?.message || err));
    throw err;
  }
};
