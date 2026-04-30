export async function fetchParsedTokens(tokensData, matricesData, options = {}) {
  const url = "/parse_tokens";
  const { signal, requestId } = options;
  const payload = { tokens: tokensData, matrices: matricesData, requestId };

  const normalizeError = (partial) => ({
    type: "error",
    code: partial?.code || "UNKNOWN_ERROR",
    message: partial?.message || "エラーが発生しました",
    ...(Number.isFinite(partial?.status) ? { status: partial.status } : {}),
    ...(Number.isFinite(partial?.retryAfter) ? { retryAfter: partial.retryAfter } : {}),
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal,
    });

    let data;
    try {
      data = await res.json();
    } catch {
      return normalizeError({
        code: "INVALID_SERVER_RESPONSE",
        message: "サーバーからのレスポンスが不正です",
        status: res.status,
      });
    }

    if (!res.ok) {
      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null;
      const retryMessage = Number.isFinite(retryAfter) && retryAfter > 0 ? ` 約${retryAfter}秒後に再試行してください。` : "";
      const statusFallback = res.status >= 500
        ? "サーバー側でエラーが発生しました。"
        : (res.status === 429 ? `リクエストが集中しています。${retryMessage}` : `サーバーエラー: ${res.status} ${res.statusText}`);
      const serverErrorData = (data && typeof data === "object") ? data : {};
      return normalizeError({
        ...serverErrorData,
        status: res.status,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined,
        code: serverErrorData.code || "HTTP_ERROR",
        message: serverErrorData.message || statusFallback,
      });
    }

    if (data.type === "error") {
      return normalizeError(data);
    }

    return data;

  } catch (err) {
    if (err?.name === "AbortError") {
      return normalizeError({ code: "REQUEST_ABORTED", message: "計算を停止しました" });
    }
    return normalizeError({ code: "NETWORK_ERROR", message: "通信に失敗しました" });
  }
}

export async function cancelCalcRequest(requestId) {
  if (!requestId) return { status: "ok", cancelled: false, requestId: "" };
  try {
    const res = await fetch("/cancel_calc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ requestId }),
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      return {
        status: "error",
        cancelled: false,
        requestId,
        type: "error",
        code: "INVALID_SERVER_RESPONSE",
        message: "キャンセル応答が不正です",
      };
    }
    if (!res.ok) {
      const serverCode = data && typeof data === "object" ? data.code : "CANCEL_HTTP_ERROR";
      const serverMessage = data && typeof data === "object" ? data.message : "キャンセル要求に失敗しました";
      return {
        status: "error",
        cancelled: false,
        requestId,
        type: "error",
        code: serverCode,
        message: serverMessage,
      };
    }
    return data && typeof data === "object"
      ? data
      : { status: "ok", cancelled: false, requestId };
  } catch {
    return {
      status: "error",
      cancelled: false,
      requestId,
      type: "error",
      code: "NETWORK_ERROR",
      message: "キャンセル通信に失敗しました",
    };
  }
}
