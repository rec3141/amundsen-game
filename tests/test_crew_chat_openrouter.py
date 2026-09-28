"""The card-table crew talk through OpenRouter when the dashboard's settings give them a key."""
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import crew_chat  # noqa: E402

CONTEXT = {'hand': 1, 'conversationTurn': 2, 'locale': 'en'}
ANSWER = {'choices': [{'message': {'content': 'Hearts are trumps today.'}}]}


class OpenRouterTests(unittest.TestCase):
    def setUp(self):
        self.handle = next(iter(crew_chat.PERSONAS))
        self.sent = []

    def fake_fetch(self, url, body=None, timeout=5, headers=None):
        self.sent.append((url, body, headers))
        return ANSWER

    def test_key_sends_to_openrouter_with_the_model(self):
        env = {'OPENROUTER_API_KEY': 'sk-shared', 'OPENROUTER_MODEL': 'some/model'}
        with patch.dict(os.environ, env, clear=False), patch.object(crew_chat, 'fetch', self.fake_fetch):
            self.assertEqual(crew_chat.reply(self.handle, CONTEXT), 'Hearts are trumps today.')
        url, body, headers = self.sent[-1]
        self.assertEqual(url, 'https://openrouter.ai/api/v1/chat/completions')
        self.assertEqual(headers, {'Authorization': 'Bearer sk-shared'})
        self.assertEqual(body['model'], 'some/model')
        self.assertNotIn('chat_template_kwargs', body)
        self.assertEqual(len(self.sent), 1, 'no local inventory check on the OpenRouter route')

    def test_model_defaults_to_gemini_flash(self):
        with patch.dict(os.environ, {'OPENROUTER_API_KEY': 'sk-dash'}, clear=False), \
                patch.object(crew_chat, 'fetch', self.fake_fetch):
            os.environ.pop('OPENROUTER_MODEL', None)
            crew_chat.reply(self.handle, CONTEXT)
        _, body, headers = self.sent[-1]
        self.assertEqual(headers['Authorization'], 'Bearer sk-dash')
        self.assertEqual(body['model'], 'google/gemini-3.8-flash')

    def test_no_key_keeps_the_local_model(self):
        with patch.dict(os.environ, {}, clear=False), patch.object(crew_chat, 'fetch', self.fake_fetch):
            os.environ.pop('OPENROUTER_API_KEY', None)
            with self.assertRaises(Exception):
                crew_chat.reply(self.handle, CONTEXT)
        self.assertNotIn('openrouter', self.sent[0][0])

if __name__ == '__main__':
    unittest.main()
