"""SearXNG engine: query a searchcast server over a unix socket.

SearXNG's own HTTP client cannot reach a unix socket, and its generic
``json_engine`` needs an ``http://`` URL. This is an *offline* engine (the kind
SearXNG uses for databases): it does its own I/O, so it can talk HTTP over the
socket searchcast serves with ``--listen /path.sock`` or ``--listen systemd``.

SearXNG loads an engine from an absolute path when ``engine`` is one (it joins
the value onto its engines directory, and an absolute path wins), so no copy
into the SearXNG package is needed::

    engines:
      - name: searchcast-web
        engine: /path/to/searchcast/integrations/searxng/searchcast
        shortcut: scw
        socket_path: /run/searchcast/searchcast.sock
        recipe: web
        timeout: 15.0

Failures are raised, never returned as an empty list, so they appear in
SearXNG's ``unresponsive_engines``: a page searchcast reports as ``blocked``
raises ``SearxEngineCaptchaException``; anything else non-2xx raises
``SearxEngineAPIException`` carrying searchcast's own error code and message.
Offline engines are not suspended after an error, so the next query tries
again, which suits a browser whose blocks are per request.
"""

import http.client
import json
import os
import socket
from urllib.parse import urlencode

from searx.exceptions import SearxEngineAPIException, SearxEngineCaptchaException

about = {
    "website": "https://github.com/wighawag/searchcast",
    "use_official_api": False,
    "require_api_key": False,
    "results": "JSON",
}

engine_type = "offline"
categories = ["general"]
paging = False

# Settings (engine attributes, set per engine in settings.yml).
socket_path = ""
"""Path of the unix socket searchcast listens on. Required.

Environment variables in it are expanded (``$VAR`` / ``${VAR}``), so one
settings file can serve several SearXNG instances, each started with its own
value. An unset variable is an error, not an empty path.
"""
recipe = ""
"""Recipe name to run. May be empty when the server has exactly one."""
timeout = 15.0
"""Seconds to wait for searchcast, which itself waits for a real page."""


class _UnixHTTPConnection(http.client.HTTPConnection):
    def __init__(self, path, timeout_seconds):
        super().__init__("localhost", timeout=timeout_seconds)
        self._socket_path = path

    def connect(self):
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(self.timeout)
        sock.connect(self._socket_path)
        self.sock = sock


def _resolved_socket_path():
    path = os.path.expandvars(socket_path)
    if not path or "$" in path:
        raise ValueError(f"searchcast engine: socket_path {socket_path!r} is empty or names an unset variable")
    return path


def init(_engine_settings=None):
    _resolved_socket_path()


def search(query, params):  # pylint: disable=unused-argument
    args = {"q": query}
    if recipe:
        args["recipe"] = recipe
    conn = _UnixHTTPConnection(_resolved_socket_path(), float(timeout))
    try:
        conn.request("GET", "/search?" + urlencode(args))
        response = conn.getresponse()
        status = response.status
        body = response.read()
    finally:
        conn.close()

    try:
        data = json.loads(body) if body else {}
    except ValueError as e:
        raise SearxEngineAPIException(f"searchcast answered {status} with invalid JSON") from e

    if status != 200:
        code = data.get("error", str(status))
        message = data.get("message", "")
        if code == "blocked":
            raise SearxEngineCaptchaException(message=f"searchcast: {message}")
        raise SearxEngineAPIException(f"searchcast {code}: {message}")

    return [
        {
            "url": result["url"],
            "title": result["title"],
            "content": result.get("content", ""),
        }
        for result in data.get("results", [])
        if result.get("url") and result.get("title")
    ]
