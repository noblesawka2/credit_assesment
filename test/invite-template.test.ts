import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Supabase invitation template retains the approved one-time token flow', async () => {
  const template = await readFile(new URL('../config/supabase-invite.html', import.meta.url), 'utf8');
  assert.match(template, /\{\{ \.RedirectTo \}\}#nobles_invite=\{\{ \.TokenHash \}\}/);
  assert.doesNotMatch(template, /access_token|refresh_token|\.ConfirmationURL/);
});
