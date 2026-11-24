"""Bounded OpenAI adapter; secrets stay in backend memory, outside static files.

This module never discovers credentials or makes health-check API calls. A cloud
backend must be selected in an explicit environment setting or backend config.
"""
from __future__ import annotations

import base64
import copy
from dataclasses import dataclass, field
import json
import math
import os
from pathlib import Path
import re
import socket
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

PROJECT = Path(__file__).resolve().parents[2]
STATIC_ROOT = PROJECT / "outputs"
DEFAULT_CONFIG = PROJECT / "work" / "runtime" / "cloud_config.json"
RESPONSES_URL = "https://api.openai.com/v1/responses"
SERVICE = "waicy-resource-commons"
MAX_RESPONSE_BYTES = 2_000_000


class BackendError(OSError):
    """An already-sanitized message that may safely reach the local client."""
    def __init__(self, code, message, status=503):
        super().__init__(message)
        self.code = code
        self.status = status


def configuration_error():
    return BackendError("configuration", "云端 AI 配置无效或缺少密钥，请检查后端配置；本次未修改任何记录。")


@dataclass(frozen=True)
class Settings:
    backend: str = "local"
    model: str = "qwen3.5:4b"
    api_key: str = field(default="", repr=False)
    proxy: str = field(default="", repr=False)

    @property
    def remote(self):
        return self.backend == "openai"

    def metadata(self):
        return {"service": SERVICE, "application": "local-prototype",
                "backend": self.backend, "provider": "OpenAI" if self.remote else "Ollama",
                "model": self.model, "localOnly": not self.remote,
                "remoteProcessing": self.remote}


def _outside_static(path):
    try:
        resolved = Path(path).expanduser().resolve()
        if not Path(path).expanduser().is_absolute() or resolved.is_relative_to(STATIC_ROOT.resolve()):
            raise configuration_error()
        return resolved
    except (OSError, TypeError, ValueError):
        raise configuration_error() from None


def _bounded_text(path, limit):
    try:
        with path.open("r", encoding="utf-8") as handle:
            value = handle.read(limit + 1)
        if len(value) > limit:
            raise configuration_error()
        return value
    except (OSError, UnicodeError):
        raise configuration_error() from None


def _dotenv_values(path, names):
    """Read only authorized names, without eval, interpolation, or env mutation."""
    values = {}
    for line in _bounded_text(path, 1_000_000).splitlines():
        match = re.fullmatch(r"\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*", line)
        if not match or match.group(1) not in names:
            continue
        value = match.group(2)
        if value.startswith(("'", '"')):
            quote = value[0]
            if len(value) < 2 or not value.endswith(quote):
                raise configuration_error()
            value = value[1:-1]
        else:
            value = re.split(r"\s+#", value, maxsplit=1)[0].strip()
        values[match.group(1)] = value
    return values


def _loopback_proxy(value):
    if not value:
        return ""
    try:
        parsed = urlparse(value)
        if (parsed.scheme != "http" or parsed.hostname not in ("localhost", "127.0.0.1", "::1")
                or not parsed.port or parsed.username or parsed.password or parsed.query
                or parsed.fragment or parsed.path not in ("", "/")):
            raise configuration_error()
        return value
    except (ValueError, TypeError):
        raise configuration_error() from None


def load_settings(environ=None, config_path=None):
    env = os.environ if environ is None else environ
    override = env.get("RESOURCE_AI_BACKEND", "").strip().lower()
    # This explicit local override never reads a cloud config or credential file.
    if override == "local":
        return Settings(model=env.get("RESOURCE_AI_MODEL", "qwen3.5:4b"))
    if override and override != "openai":
        raise configuration_error()
    path = _outside_static(config_path or env.get("RESOURCE_CLOUD_CONFIG_FILE", str(DEFAULT_CONFIG)))
    config = {}
    if path.exists():
        try:
            config = json.loads(_bounded_text(path, 20_000))
            if not isinstance(config, dict) or set(config) - {"backend", "credential_file", "model", "proxy_env_name"}:
                raise configuration_error()
        except (ValueError, TypeError):
            raise configuration_error() from None
    backend = override or config.get("backend", "local")
    if backend == "local":
        return Settings(model=env.get("RESOURCE_AI_MODEL", "qwen3.5:4b"))
    if backend != "openai":
        raise configuration_error()
    proxy_name = config.get("proxy_env_name", "AP_ATLAS_PROXY_URL")
    if not isinstance(proxy_name, str) or not re.fullmatch(r"[A-Z][A-Z0-9_]{0,79}", proxy_name) or proxy_name == "OPENAI_API_KEY":
        raise configuration_error()
    values = {}
    if config.get("credential_file"):
        # No file access is needed when both authorized fields are provided by env.
        if not env.get("OPENAI_API_KEY") or proxy_name not in env:
            values = _dotenv_values(_outside_static(config["credential_file"]), {"OPENAI_API_KEY", proxy_name})
    key = env.get("OPENAI_API_KEY") or values.get("OPENAI_API_KEY", "")
    if not isinstance(key, str) or not key or len(key) > 1024 or re.search(r"\s", key):
        raise configuration_error()
    model = env.get("RESOURCE_AI_MODEL") or config.get("model", "gpt-6.1-terra")
    if not isinstance(model, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,119}", model):
        raise configuration_error()
    proxy = _loopback_proxy(env.get(proxy_name, values.get(proxy_name, "")))
    return Settings(backend="openai", model=model, api_key=key, proxy=proxy)


def strict_schema(schema):
    """Use the supported strict subset; application validation still runs later.

    Optional properties are required in the transport schema. Existing optional
    ``relations`` is an array and the model may return [] when none are needed.
    Bounds stay in the application validator, independent of model enforcement.
    """
    result = copy.deepcopy(schema)
    def visit(node):
        for key in ("minimum", "maximum", "minItems", "maxItems", "minLength", "maxLength"):
            node.pop(key, None)
        if "enum" in node and "type" not in node:
            first = node["enum"][0]
            node["type"] = "string" if isinstance(first, str) else "number"
        if "properties" in node:
            node["additionalProperties"] = False
            node["required"] = list(node["properties"])
            for child in node["properties"].values():
                visit(child)
        if "items" in node:
            visit(node["items"])
    visit(result)
    return result


def image_data_url(value):
    try:
        if not isinstance(value, str) or len(value) > 4_500_000:
            raise ValueError()
        raw = base64.b64decode(value, validate=True)
        if not raw or len(raw) > 3_000_000:
            raise ValueError()
        if raw.startswith(b"\x89PNG\r\n\x1a\n"):
            mime = "image/png"
        elif raw.startswith(b"\xff\xd8\xff"):
            mime = "image/jpeg"
        elif len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
            mime = "image/webp"
        else:
            raise ValueError()
        return "data:" + mime + ";base64," + value
    except (ValueError, TypeError):
        raise BackendError("image", "图片编码或实际格式无效，请重新选择 PNG、JPEG 或 WebP。", 400) from None


def build_payload(settings, body):
    if not isinstance(body, dict) or not isinstance(body.get("format"), dict):
        raise BackendError("request", "AI 请求结构无效；本次未修改任何记录。", 400)
    messages = []
    image_count = 0
    for message in body.get("messages", []):
        if message.get("role") not in ("system", "user", "assistant") or not isinstance(message.get("content"), str):
            raise BackendError("request", "AI 请求结构无效；本次未修改任何记录。", 400)
        content = [{"type": "input_text", "text": message["content"]}]
        for encoded in message.get("images", []):
            image_count += 1
            if image_count > 4:
                raise BackendError("image", "单次 AI 请求最多四张分析图片。", 400)
            content.append({"type": "input_image", "image_url": image_data_url(encoded), "detail": "auto"})
        messages.append({"role": message["role"], "content": content})
    if not messages:
        raise BackendError("request", "AI 请求缺少输入；本次未修改任何记录。", 400)
    # Reasoning tokens share the output budget. A scene gets at most 6000; the
    # smaller item/request/review calls at most 4096. No automatic retry is used.
    requested = body.get("options", {}).get("num_predict", 1300)
    maximum = 6000 if isinstance(requested, int) and requested > 1300 else 4096
    payload = {"model": settings.model, "store": False, "stream": False,
               "input": messages, "max_output_tokens": maximum,
               "text": {"format": {"type": "json_schema", "name": "resource_extraction",
                                    "strict": True, "schema": strict_schema(body["format"])}}}
    if settings.model == "gpt-6.1-terra":
        payload["reasoning"] = {"effort": "medium"}
    elif settings.model.startswith("gpt-5"):
        payload["reasoning"] = {"effort": "low"}
    return payload


def safe_usage(value):
    if not isinstance(value, dict):
        return {}
    result = {}
    for name in ("input_tokens", "output_tokens", "total_tokens"):
        count = value.get(name)
        if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 100_000_000:
            result[name] = count
    for name, child in (("input_tokens_details", "cached_tokens"), ("output_tokens_details", "reasoning_tokens")):
        count = value.get(name, {}).get(child) if isinstance(value.get(name), dict) else None
        if isinstance(count, int) and not isinstance(count, bool) and 0 <= count <= 100_000_000:
            result[name] = {child: count}
    return result


def parse_response(result):
    if not isinstance(result, dict):
        raise BackendError("invalid_response", "云端 AI 返回格式异常；本次未保存任何草稿。", 502)
    if result.get("status") == "incomplete":
        raise BackendError("incomplete", "云端 AI 输出未完成，请分区补拍或缩短输入后重试；本次未保存草稿。", 502)
    if result.get("status") != "completed":
        raise BackendError("unavailable", "云端 AI 未完成分析，请稍后手动重试；本次未修改任何记录。", 502)
    texts = []
    output = result.get("output")
    if not isinstance(output, list):
        raise BackendError("invalid_response", "云端 AI 返回格式异常；本次未保存任何草稿。", 502)
    for message in output:
        if not isinstance(message, dict) or message.get("type") != "message":
            continue
        content = message.get("content", [])
        if not isinstance(content, list):
            raise BackendError("invalid_response", "云端 AI 返回格式异常；本次未保存任何草稿。", 502)
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "refusal":
                raise BackendError("refusal", "云端 AI 无法分析这次输入，可更换照片或手动记录；本次未保存草稿。", 422)
            if block.get("type") == "output_text" and isinstance(block.get("text"), str):
                texts.append(block["text"])
    text = "".join(texts)
    try:
        value = json.loads(text)
        if not isinstance(value, dict):
            raise ValueError()
    except (ValueError, TypeError):
        raise BackendError("invalid_json", "云端 AI 没有返回完整的物品结构，请手动重试；本次未保存草稿。", 502) from None
    return {"message": {"content": json.dumps(value, ensure_ascii=False)},
            "done_reason": "stop", "usage": safe_usage(result.get("usage"))}


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Never forward an Authorization header to another host or endpoint.
        raise BackendError("redirect", "云端 AI 连接被重定向，已停止请求；本次未修改任何记录。", 502)


def openai_json(settings, body, timeout=180):
    if not settings.remote or not settings.api_key:
        raise configuration_error()
    if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or timeout <= 0:
        raise BackendError("timeout", "AI 请求时间预算已耗尽；本次未修改任何记录。", 504)
    timeout = min(float(timeout), 180)
    payload = build_payload(settings, body)
    req = Request(RESPONSES_URL, data=json.dumps(payload, ensure_ascii=False, allow_nan=False).encode(),
                  headers={"Content-Type": "application/json", "Authorization": "Bearer " + settings.api_key}, method="POST")
    # Ignore ambient HTTP(S)_PROXY; only the explicitly named loopback proxy is
    # allowed. No SDK retries, alternative endpoint, or paid fallback is used.
    opener = build_opener(ProxyHandler({"https": settings.proxy} if settings.proxy else {}), _NoRedirect())
    try:
        with opener.open(req, timeout=timeout) as response:
            raw = response.read(MAX_RESPONSE_BYTES + 1)
            if len(raw) > MAX_RESPONSE_BYTES:
                raise BackendError("oversized_response", "云端 AI 返回内容过大，已停止处理；本次未保存草稿。", 502)
        result = json.loads(raw)
    except BackendError:
        raise
    except HTTPError as exc:
        # Do not read or return the provider's body, URL, or headers.
        if exc.code in (401, 403):
            raise BackendError("authentication", "云端 AI 密钥或账户权限不可用，请检查后端配置；本次未修改任何记录。") from None
        if exc.code == 429:
            raise BackendError("rate_limit", "云端 AI 暂时达到额度或速率限制，请稍后手动重试；本次未修改任何记录。", 429) from None
        if 400 <= exc.code < 500:
            raise BackendError("provider_request", "云端 AI 拒绝了请求配置，请检查后端模型与参数；本次未修改任何记录。", 502) from None
        raise BackendError("provider_unavailable", "云端 AI 暂时不可用，请稍后手动重试；本次未修改任何记录。", 503) from None
    except (TimeoutError, socket.timeout):
        raise BackendError("timeout", "云端 AI 响应超时，请稍后手动重试；本次未修改任何记录。", 504) from None
    except URLError as exc:
        if isinstance(exc.reason, (TimeoutError, socket.timeout)):
            raise BackendError("timeout", "云端 AI 响应超时，请稍后手动重试；本次未修改任何记录。", 504) from None
        raise BackendError("connection", "无法连接云端 AI，请检查网络或受控代理；本次未修改任何记录。") from None
    except (OSError, ValueError, TypeError, UnicodeError):
        raise BackendError("invalid_response", "云端 AI 连接或返回格式异常，请稍后手动重试；本次未修改任何记录。", 502) from None
    return parse_response(result)
