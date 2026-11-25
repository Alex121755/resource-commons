"""Cloud adapter tests use fake temporary credentials and mocked HTTP only."""
import base64
import copy
import io
import json
from pathlib import Path
import socket
import tempfile
from unittest import TestCase, main
from unittest.mock import MagicMock, patch
from urllib.error import HTTPError, URLError

import ai_backend as ai
import launch
import server
from test_server import IMAGE, scene_sample
from test_scene_integration import sample as component_scene

FAKE_KEY = "resource-commons-test-placeholder"
SETTINGS = ai.Settings("openai", "gpt-5.4-mini", FAKE_KEY)


def body(images=None):
    message = {"role": "user", "content": "Identify the visible items"}
    if images is not None:
        message["images"] = images
    return {"model": "ignored-local-model", "messages": [
        {"role": "system", "content": "Return data only"}, message],
        "format": server.SCENE_SCHEMA, "options": {"num_predict": 2300, "temperature": 0}}


def completed(value=None, **extra):
    return {"status": "completed", "output": [{"type": "message", "content": [
        {"type": "output_text", "text": json.dumps(value if value is not None else scene_sample())}]}], **extra}


class ConfigurationTests(TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.config = self.directory / "cloud.json"

    def write_config(self, **extra):
        self.config.write_text(json.dumps({"backend": "openai", **extra}))

    def test_local_override_never_reads_any_config_or_credentials(self):
        with patch.object(Path, "open", side_effect=AssertionError("must not read")):
            settings = ai.load_settings({"RESOURCE_AI_BACKEND": "local"}, self.config)
        self.assertEqual(settings.backend, "local")

    def test_no_config_is_local_and_does_not_discover_key(self):
        settings = ai.load_settings({"OPENAI_API_KEY": FAKE_KEY}, self.config)
        self.assertFalse(settings.remote)
        self.assertEqual(settings.api_key, "")

    def test_only_two_names_extracted_without_executing_dotenv(self):
        credential = self.directory / ".env.local"
        credential.write_text("UNRELATED_SECRET=do-not-return\nexport OPENAI_API_KEY='" + FAKE_KEY + "'\nAP_ATLAS_PROXY_URL=http://127.0.0.1:7890\nUNRELATED=$(touch /tmp/do-not-run)\n")
        self.write_config(credential_file=str(credential), model="gpt-5.4-mini", proxy_env_name="AP_ATLAS_PROXY_URL")
        settings = ai.load_settings({}, self.config)
        self.assertEqual(settings.api_key, FAKE_KEY)
        self.assertEqual(settings.proxy, "http://127.0.0.1:7890")
        serialized = json.dumps(settings.metadata()) + repr(settings)
        self.assertNotIn(FAKE_KEY, serialized)
        self.assertNotIn(str(credential), serialized)
        self.assertNotIn("do-not-return", serialized)

    def test_controlled_env_wins_and_ignores_ambient_proxy(self):
        self.write_config()
        settings = ai.load_settings({"OPENAI_API_KEY": FAKE_KEY, "HTTPS_PROXY": "http://untrusted.example:9999"}, self.config)
        self.assertEqual(settings.proxy, "")
        self.assertEqual(settings.model, "gpt-6.1-terra")

    def test_explicit_model_override_keeps_the_requested_model(self):
        self.write_config(model="gpt-5.4-mini")
        settings = ai.load_settings({"OPENAI_API_KEY": FAKE_KEY,
                                     "RESOURCE_AI_MODEL": "gpt-6.1-terra"}, self.config)
        self.assertEqual(settings.model, "gpt-6.1-terra")

    def test_remote_or_authenticated_or_non_http_proxy_rejected(self):
        self.write_config()
        for proxy in ("http://proxy.example:1234", "https://127.0.0.1:1234", "http://u:p@127.0.0.1:1234", "http://127.0.0.1:1234/path", "http://127.0.0.1:1234?key=secret"):
            with self.subTest(proxy=proxy), self.assertRaises(ai.BackendError):
                ai.load_settings({"OPENAI_API_KEY": FAKE_KEY, "AP_ATLAS_PROXY_URL": proxy}, self.config)

    def test_bad_configuration_never_echoes_contents_or_paths(self):
        self.config.write_text("not-json " + FAKE_KEY)
        with self.assertRaises(ai.BackendError) as raised:
            ai.load_settings({}, self.config)
        self.assertNotIn(FAKE_KEY, str(raised.exception))
        self.assertNotIn(str(self.config), str(raised.exception))

    def test_credentials_and_config_cannot_be_served_from_outputs(self):
        with self.assertRaises(ai.BackendError):
            ai.load_settings({}, ai.STATIC_ROOT / ".env.json")
        self.write_config(credential_file=str(ai.STATIC_ROOT / ".env.local"))
        with self.assertRaises(ai.BackendError):
            ai.load_settings({}, self.config)

    def test_invalid_backend_unknown_settings_and_relative_credentials_rejected(self):
        for config in ({"backend": "unknown"}, {"backend": "openai", "api_key": FAKE_KEY}, {"backend": "openai", "credential_file": "relative.env"}):
            self.config.write_text(json.dumps(config))
            with self.subTest(config=list(config)), self.assertRaises(ai.BackendError):
                ai.load_settings({}, self.config)

    def test_missing_key_is_safe_configuration_error(self):
        self.write_config()
        with self.assertRaises(ai.BackendError) as raised:
            ai.load_settings({}, self.config)
        self.assertEqual(raised.exception.code, "configuration")


class TransportTests(TestCase):
    def test_actual_image_signature_sets_mime(self):
        png = IMAGE.split(",", 1)[1]
        self.assertTrue(ai.image_data_url(png).startswith("data:image/png;base64,"))
        jpeg = base64.b64encode(b"\xff\xd8\xff" + b"dummy").decode()
        webp = base64.b64encode(b"RIFF1234WEBP" + b"dummy").decode()
        self.assertIn("image/jpeg", ai.image_data_url(jpeg))
        self.assertIn("image/webp", ai.image_data_url(webp))
        for invalid in (base64.b64encode(b"not-a-photo").decode(), "bad%%", "", None):
            with self.subTest(invalid=invalid), self.assertRaises(ai.BackendError):
                ai.image_data_url(invalid)

    def test_payload_is_bounded_store_false_strict_and_no_temperature(self):
        original = body([IMAGE.split(",", 1)[1]])
        snapshot = copy.deepcopy(original)
        payload = ai.build_payload(SETTINGS, original)
        self.assertEqual(original, snapshot)
        self.assertEqual(payload["model"], "gpt-5.4-mini")
        self.assertFalse(payload["store"])
        self.assertFalse(payload["stream"])
        self.assertNotIn("temperature", payload)
        self.assertEqual(payload["reasoning"], {"effort": "low"})
        self.assertEqual(payload["max_output_tokens"], 6000)
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertEqual(payload["input"][1]["content"][1]["type"], "input_image")
        self.assertTrue(payload["input"][1]["content"][1]["image_url"].startswith("data:image/png;"))
        schema = payload["text"]["format"]["schema"]
        self.assertIn("relations", schema["required"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(schema["properties"]["items"]["items"]["properties"]["category"]["type"], "string")
        self.assertNotIn("maximum", schema["properties"]["items"]["items"]["properties"]["bbox"]["items"])

    def test_review_budget_and_four_image_limit(self):
        request = body([IMAGE.split(",", 1)[1]] * 4)
        request["options"]["num_predict"] = 850
        self.assertEqual(ai.build_payload(SETTINGS, request)["max_output_tokens"], 4096)
        request["messages"][1]["images"].append(IMAGE.split(",", 1)[1])
        with self.assertRaises(ai.BackendError):
            ai.build_payload(SETTINGS, request)

    def test_terra_image_request_uses_medium_and_keeps_output_guards(self):
        settings = ai.Settings("openai", "gpt-6.1-terra", FAKE_KEY)
        payload = ai.build_payload(settings, body([IMAGE.split(",", 1)[1]]))
        self.assertEqual(payload["model"], "gpt-6.1-terra")
        self.assertEqual(payload["reasoning"], {"effort": "medium"})
        self.assertEqual(payload["input"][1]["content"][1]["type"], "input_image")
        self.assertTrue(payload["text"]["format"]["strict"])
        self.assertEqual(payload["max_output_tokens"], 6000)
        self.assertFalse(payload["store"])
        self.assertNotIn("temperature", payload)

    def test_completed_response_uses_actual_output_not_injected_top_level_text(self):
        response = completed(usage={"input_tokens": 20, "output_tokens": 30, "total_tokens": 50,
                                    "output_tokens_details": {"reasoning_tokens": 10}, "secret": FAKE_KEY})
        response["output_text"] = "untrusted helper field"
        result = ai.parse_response(response)
        self.assertEqual(json.loads(result["message"]["content"]), scene_sample())
        self.assertEqual(result["done_reason"], "stop")
        self.assertEqual(result["usage"]["total_tokens"], 50)
        self.assertNotIn(FAKE_KEY, json.dumps(result))

    def test_refusal_truncation_or_bad_json_never_returned_as_success(self):
        refusal = {"status": "completed", "output": [{"type": "message", "content": [{"type": "refusal", "refusal": FAKE_KEY}]}]}
        bad = completed(); bad["output"][0]["content"][0]["text"] = "not-json " + FAKE_KEY
        for response, code in ((refusal, "refusal"), ({"status": "incomplete"}, "incomplete"), (bad, "invalid_json"), ({"status": "failed", "error": FAKE_KEY}, "unavailable")):
            with self.subTest(code=code), self.assertRaises(ai.BackendError) as raised:
                ai.parse_response(response)
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn(FAKE_KEY, str(raised.exception))

    def test_response_size_and_timeout_bounded_and_no_retry(self):
        opener = MagicMock()
        response = opener.open.return_value.__enter__.return_value
        response.read.return_value = json.dumps(completed()).encode()
        with patch.object(ai, "build_opener", return_value=opener) as builder:
            result = ai.openai_json(SETTINGS, body(), timeout=9999)
        self.assertEqual(result["done_reason"], "stop")
        request = opener.open.call_args.args[0]
        self.assertEqual(request.full_url, ai.RESPONSES_URL)
        self.assertEqual(request.get_header("Authorization"), "Bearer " + FAKE_KEY)
        self.assertEqual(opener.open.call_args.kwargs["timeout"], 180)
        self.assertEqual(opener.open.call_count, 1)
        self.assertEqual(builder.call_args.args[0].proxies, {})
        response.read.assert_called_once_with(ai.MAX_RESPONSE_BYTES + 1)
        response.read.return_value = b"x" * (ai.MAX_RESPONSE_BYTES + 1)
        with patch.object(ai, "build_opener", return_value=opener), self.assertRaises(ai.BackendError) as raised:
            ai.openai_json(SETTINGS, body())
        self.assertEqual(raised.exception.code, "oversized_response")

    def test_provider_errors_are_fixed_and_do_not_read_error_body(self):
        for status, code in ((401, "authentication"), (403, "authentication"), (429, "rate_limit"), (400, "provider_request"), (503, "provider_unavailable")):
            error_body = MagicMock()
            error = HTTPError(ai.RESPONSES_URL + "?secret=" + FAKE_KEY, status, FAKE_KEY, {}, error_body)
            opener = MagicMock(); opener.open.side_effect = error
            with self.subTest(status=status), patch.object(ai, "build_opener", return_value=opener), self.assertRaises(ai.BackendError) as raised:
                ai.openai_json(SETTINGS, body())
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn(FAKE_KEY, str(raised.exception))
            error_body.read.assert_not_called()
            self.assertEqual(opener.open.call_count, 1)

    def test_connection_and_timeout_messages_are_safe(self):
        for error, code in ((URLError(FAKE_KEY), "connection"), (URLError(socket.timeout(FAKE_KEY)), "timeout"), (socket.timeout(FAKE_KEY), "timeout")):
            opener = MagicMock(); opener.open.side_effect = error
            with patch.object(ai, "build_opener", return_value=opener), self.assertRaises(ai.BackendError) as raised:
                ai.openai_json(SETTINGS, body())
            self.assertEqual(raised.exception.code, code)
            self.assertNotIn(FAKE_KEY, str(raised.exception))

    def test_redirect_never_forwards_credential(self):
        with self.assertRaises(ai.BackendError):
            ai._NoRedirect().redirect_request(None, None, 302, "redirect", {}, "https://other.example")


class CloudIntegrationTests(TestCase):
    def setUp(self):
        self.settings_patch = patch.object(server, "SETTINGS", SETTINGS)
        self.settings_patch.start(); self.addCleanup(self.settings_patch.stop)
        self.model_patch = patch.object(server, "MODEL", SETTINGS.model)
        self.model_patch.start(); self.addCleanup(self.model_patch.stop)

    def test_cloud_health_has_no_network_and_no_secret(self):
        with patch.object(server, "openai_json", side_effect=AssertionError("health must not call API")), patch.object(server, "ollama_json", side_effect=AssertionError("health must not call local model")):
            state = server.health()
        self.assertEqual(state["service"], ai.SERVICE)
        self.assertFalse(state["localOnly"])
        self.assertTrue(state["remoteProcessing"])
        self.assertTrue(state["modelAvailable"])
        self.assertFalse(state["apiVerified"])
        self.assertEqual(state["availabilityCheck"], "configuration-only")
        self.assertNotIn(FAKE_KEY, json.dumps(state))

    def test_cloud_scene_skips_both_local_models_and_keeps_guards(self):
        result = ai.parse_response(completed(usage={"input_tokens": 20, "output_tokens": 30, "total_tokens": 50}))
        with patch.object(server, "openai_json", return_value=result) as cloud, patch.object(server, "ollama_json", side_effect=AssertionError("no Ollama")), patch.object(server, "detector_hints", side_effect=AssertionError("no local SSD")):
            response = server.extract("scene", {"image": IMAGE})
        self.assertEqual(cloud.call_count, 1)
        self.assertEqual(len(response["data"]["items"]), 2)
        self.assertFalse(response["detectorAssist"]["used"])
        self.assertFalse(response["localOnly"])
        self.assertTrue(response["requiresHumanConfirmation"])
        self.assertEqual(response["usage"]["total_tokens"], 50)
        self.assertNotIn("owner", response["data"])

    def test_component_review_uses_cloud_and_sums_usage(self):
        initial = ai.parse_response(completed(component_scene(), usage={"input_tokens": 20, "output_tokens": 30, "total_tokens": 50}))
        review = ai.parse_response(completed({"relations": [{"parentId": "scene-001", "childId": "scene-002", "relation": "separate", "evidence": "The independent keyboard housing is clearly visible."}]}, usage={"input_tokens": 10, "output_tokens": 5, "total_tokens": 15}))
        with patch.object(server, "openai_json", side_effect=[initial, review]) as cloud, patch.object(server, "ollama_json", side_effect=AssertionError("no Ollama")), patch.object(server, "detector_hints", side_effect=AssertionError("no SSD")):
            response = server.extract("scene", {"image": IMAGE})
        self.assertEqual(cloud.call_count, 2)
        self.assertEqual(response["usage"]["calls"], 2)
        self.assertEqual(response["usage"]["total_tokens"], 65)
        self.assertEqual(response["componentReview"]["status"], "completed")
        self.assertFalse(any(p["applyByDefault"] for p in response["grouping"]["proposals"]))

    def test_component_cloud_failure_preserves_candidates_as_uncertain(self):
        initial = ai.parse_response(completed(component_scene()))
        with patch.object(server, "openai_json", side_effect=[initial, ai.BackendError("rate_limit", "Safe error", 429)]):
            response = server.extract("scene", {"image": IMAGE})
        self.assertEqual(len(response["data"]["items"]), 2)
        self.assertEqual(response["componentReview"]["status"], "unavailable")
        self.assertFalse(any(p["applyByDefault"] for p in response["grouping"]["proposals"]))

    def test_cloud_schema_cannot_add_permission(self):
        data = scene_sample(); data["items"][0]["approved"] = True
        with patch.object(server, "openai_json", return_value=ai.parse_response(completed(data))), self.assertRaises(ValueError):
            server.extract("scene", {"image": IMAGE})
        self.assertFalse(server.MODEL_LOCK.locked())

    def test_cloud_http_error_maps_safe_status_and_releases_lock(self):
        with patch.object(server, "openai_json", side_effect=ai.BackendError("authentication", "Fixed safe error", 503)), self.assertRaises(ai.BackendError):
            server.extract("scene", {"image": IMAGE})
        self.assertFalse(server.MODEL_LOCK.locked())


class LauncherTests(TestCase):
    def test_existing_cloud_server_is_reused_without_starting_process(self):
        with patch.object(launch, "read_json", return_value={"service": ai.SERVICE, "localOnly": False}), patch.object(launch.subprocess, "Popen", side_effect=AssertionError("do not duplicate server")), patch("sys.argv", ["launch.py", "--no-browser"]):
            launch.main()

    def test_cloud_launcher_does_not_probe_or_launch_ollama(self):
        process = MagicMock(); process.poll.return_value = 0
        health = {"service": ai.SERVICE, "localOnly": False, "message": "Cloud service configured"}
        def read(url):
            self.assertNotIn("11435", url)
            return None if read.calls == 0 else health
        read.calls = 0
        def read_count(url):
            result = read(url); read.calls += 1; return result
        with patch.object(launch, "read_json", side_effect=read_count), patch.object(launch, "load_settings", return_value=SETTINGS), patch.object(launch.subprocess, "Popen", return_value=process) as popen, patch.object(launch.shutil, "which", side_effect=AssertionError("no Ollama discovery")), patch("sys.argv", ["launch.py", "--no-browser"]):
            launch.main()
        self.assertEqual(popen.call_count, 1)
        self.assertTrue(popen.call_args.args[0][1].endswith("server.py"))
        self.assertEqual(popen.call_args.kwargs["env"]["RESOURCE_SCENE_HINTS"], "0")


if __name__ == "__main__":
    main()
