export async function fetchParsedTokens(tokensData, matricesData) {
  const url = "/parse_tokens";
  const payload = { tokens: tokensData, matrices: matricesData };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    let data;
    try {
      data = await res.json();
    } catch {
      return { type: "error", message: "サーバーからのレスポンスが不正です" };
    }

    if (!res.ok) {
      const retryAfterRaw = res.headers.get("Retry-After");
      const retryAfter = retryAfterRaw ? Number.parseInt(retryAfterRaw, 10) : null;
      const retryMessage = Number.isFinite(retryAfter) && retryAfter > 0
        ? ` 約${retryAfter}秒後に再試行してください。`
        : "";
      const statusMessage = res.status >= 500
        ? "サーバー側でエラーが発生しました。"
        : (res.status === 429 ? `リクエストが集中しています。${retryMessage}` : "");
      const serverErrorData = (data && typeof data === "object") ? data : {};
      return {
        ...serverErrorData,
        type: "error",
        code: serverErrorData.code || "HTTP_ERROR",
        message: serverErrorData.message || statusMessage || `サーバーエラー: ${res.status} ${res.statusText}`,
        status: res.status,
        retryAfter: Number.isFinite(retryAfter) ? retryAfter : undefined
      };
    }

    // サーバーが返した JSON 内のエラーもチェック
    if (data.type === "error") {
      return { type: "error", ...data };
    }

    return data;

  } catch (err) {
    return { type: "error", message: "通信に失敗しました" };
  }
}
