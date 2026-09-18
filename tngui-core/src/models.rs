//! `/v1/models` 模型发现与响应解析，统一定义模型下拉的数据来源。

use std::time::Duration;

use serde_json::Value;

/// 请求本地 pre-TNG proxy 的 `/v1/models`，由 proxy 直连 capi。
pub async fn list_models(port: u16) -> Result<Vec<String>, String> {
    let url = format!("http://127.0.0.1:{port}/v1/models");
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| format!("构建模型发现客户端失败: {e}"))?;
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("请求 capi 模型列表失败: {e}"))?;
    let status = response.status().as_u16();
    let body = response
        .bytes()
        .await
        .map_err(|e| format!("读取模型列表响应失败: {e}"))?;
    parse_model_list(status, &body)
}

/// 解析 OpenAI-compatible `/v1/models` 响应，返回不重复、非空白的模型 ID。
pub fn parse_model_list(status: u16, body: &[u8]) -> Result<Vec<String>, String> {
    if !(200..300).contains(&status) {
        return Err(format!("GET /v1/models HTTP {status}"));
    }
    let body_text =
        std::str::from_utf8(body).map_err(|e| format!("模型列表响应不是有效 UTF-8: {e}"))?;
    let body_obj: Value =
        serde_json::from_str(body_text).map_err(|e| format!("模型列表响应 JSON 解析失败: {e}"))?;
    if !body_obj.is_object() {
        return Err("模型列表响应顶层必须是 JSON object".to_string());
    }
    let data = body_obj
        .get("data")
        .and_then(Value::as_array)
        .ok_or("模型列表响应缺少 data 数组")?;
    let mut model_ids = Vec::new();
    for item in data {
        if !item.is_object() {
            return Err("模型列表响应 data 项必须是 JSON object".to_string());
        }
        let id_value = item
            .get("id")
            .and_then(Value::as_str)
            .ok_or("模型列表响应 data 项缺少字符串 id")?;
        if id_value.trim().is_empty() {
            continue;
        }
        if !model_ids.iter().any(|existing| existing == id_value) {
            model_ids.push(id_value.to_string());
        }
    }
    Ok(model_ids)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_model_list_success_and_non_2xx() {
        let body = r#"{"object":"list","data":[{"id":"model-a"},{"id":" model-b "},{"id":"model-a"},{"id":""},{"id":"   "}]}"#;
        assert_eq!(
            parse_model_list(200, body.as_bytes()).unwrap(),
            vec!["model-a", " model-b "]
        );
        assert!(parse_model_list(200, br#"{"data":["model-a"]}"#).is_err());
        assert!(parse_model_list(200, br#"{"data":[{"foo":"model-a"}]}"#).is_err());
        assert!(
            parse_model_list(400, b"{}")
                .unwrap_err()
                .contains("HTTP 400")
        );
    }

    #[test]
    fn parse_model_list_rejects_invalid_shapings() {
        for body in [
            r#"{"data":"x"}"#,
            r#"{"data":{}}"#,
            r#"["m"]"#,
            r#"[]"#,
            "not-json",
        ] {
            assert!(parse_model_list(200, body.as_bytes()).is_err());
        }
    }

    #[test]
    fn parse_model_list_accepts_empty_data() {
        assert_eq!(
            parse_model_list(200, br#"{"data":[]}"#).unwrap(),
            Vec::<String>::new()
        );
    }
}
