# 火山方舟 Seedream 5.0 Pro

PoloX 现在支持通过火山方舟中国区调用 Seedream 5.0 Pro。该 provider 与现有 fal provider 并存，项目会继续使用统一的 `GenerationJob` 队列和本地结果归档。

## 配置

在右上角打开 Service connection，填写：

- Ark API key：火山方舟控制台创建的 API Key；
- Ark Base URL：默认 `https://ark.cn-beijing.volces.com/api/v3`；
- Seedream 5.0 Pro 模型 ID：以你的方舟控制台为准，默认候选值为 `doubao-seedream-5-0-pro-260628`。

Ark 连接测试只调用 `GET /models`，不会发起付费生图。密钥只保存在本机 SQLite 的 `local_service_settings` 中，不会返回到前端。

## API

调用统一生成接口：

```http
POST /api/ai/generate
Content-Type: application/json
```

文本生图：

```json
{
  "model": "ark/seedream/5-pro-text-to-image",
  "category": "Image",
  "task": "Text to Image",
  "input": {
    "prompt": "一张温暖自然的家庭旅行相册封面，胶片摄影风格",
    "size": "2K",
    "watermark": false
  }
}
```

参考图生图：

```json
{
  "model": "ark/seedream/5-pro-image-to-image",
  "category": "Image",
  "task": "Image to Image",
  "input": {
    "prompt": "保持人物和构图不变，转换为复古胶片相册风格",
    "image_urls": ["https://example.com/reference.png"],
    "size": "2K",
    "watermark": false
  }
}
```

上传到本地的图片会在服务端转换为 data URL 后提交给 Ark，因此使用 Ark 时不再强制要求配置 fal。Ark 返回的临时图片 URL 会立即下载并归档到 `.data/media`。
