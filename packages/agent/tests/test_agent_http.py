import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

AGENT_DIR = Path(__file__).resolve().parents[1]
if str(AGENT_DIR) not in sys.path:
    sys.path.insert(0, str(AGENT_DIR))

import agent  # noqa: E402


class PostJsonWithRetryTests(unittest.TestCase):
    def test_retries_retryable_status_once_and_returns_successful_response(self) -> None:
        first_response = Mock(status_code=502)
        second_response = Mock(status_code=200)

        with patch.object(agent.requests, "post", side_effect=[first_response, second_response]) as post_mock:
            with patch.object(agent.time, "sleep") as sleep_mock:
                response = agent._post_json_with_retry(
                    "https://pulse.example.com/api/heartbeat",
                    "token",
                    {"ok": True},
                    "Heartbeat POST for player-1",
                    retry_delays_seconds=(0.25,),
                )

        self.assertIs(response, second_response)
        self.assertEqual(post_mock.call_count, 2)
        sleep_mock.assert_called_once_with(0.25)

    def test_does_not_retry_non_retryable_status(self) -> None:
        response = Mock(status_code=401)

        with patch.object(agent.requests, "post", return_value=response) as post_mock:
            with patch.object(agent.time, "sleep") as sleep_mock:
                returned = agent._post_json_with_retry(
                    "https://pulse.example.com/api/heartbeat",
                    "token",
                    {"ok": True},
                    "Heartbeat POST for player-1",
                    retry_delays_seconds=(0.25,),
                )

        self.assertIs(returned, response)
        post_mock.assert_called_once()
        sleep_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
