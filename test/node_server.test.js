import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import http from "node:http";
import test from "node:test";

import { hubHttpProxy, requestHubJson } from "../src/node_server.js";

test("requestHubJson sends HTTP Hub requests through http_proxy", async () => {
  const captured = {};
  const originalRequest = http.request;
  const previousToken = process.env.TMUXFLEET_NODE_TOKEN;
  const previousHttpProxy = process.env.http_proxy;
  const previousHttpProxyUpper = process.env.HTTP_PROXY;
  try {
    http.request = fakeHttpRequest(captured, { id: "command-1" });
    process.env.TMUXFLEET_NODE_TOKEN = "test-token";
    process.env.http_proxy = "http://proxy.local:8888";
    delete process.env.HTTP_PROXY;

    const payload = await requestHubJson("http://hub.example:8090", "POST", "/api/agent/poll", {
      name: "devbox"
    });

    assert.deepEqual(payload, { id: "command-1" });
    assert.equal(captured.options.host, "proxy.local");
    assert.equal(captured.options.port, 8888);
    assert.equal(captured.options.method, "POST");
    assert.equal(captured.options.path, "http://hub.example:8090/api/agent/poll");
    assert.equal(captured.options.headers.host, "hub.example:8090");
    assert.equal(captured.options.headers.authorization, "Bearer test-token");
    assert.equal(captured.body, JSON.stringify({ name: "devbox" }));
  } finally {
    http.request = originalRequest;
    restoreEnv("TMUXFLEET_NODE_TOKEN", previousToken);
    restoreEnv("http_proxy", previousHttpProxy);
    restoreEnv("HTTP_PROXY", previousHttpProxyUpper);
  }
});

test("hubHttpProxy applies only to HTTP Hub URLs", () => {
  const env = {
    http_proxy: "http://127.0.0.1:7890",
    HTTP_PROXY: "http://127.0.0.1:7891"
  };

  assert.equal(hubHttpProxy("http://hub.example:8090", env), "http://127.0.0.1:7890");
  assert.equal(hubHttpProxy("https://hub.example", env), "");
});

function fakeHttpRequest(captured, payload) {
  return (options, callback) => {
    captured.options = options;
    const request = new EventEmitter();
    request.destroy = (error) => { request.emit("error", error); };
    request.end = (body = "") => {
      captured.body = body;
      queueMicrotask(() => {
        const response = new EventEmitter();
        response.statusCode = 200;
        response.setEncoding = () => {};
        callback(response);
        response.emit("data", JSON.stringify(payload));
        response.emit("end");
      });
    };
    return request;
  };
}

function restoreEnv(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
