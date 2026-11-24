# Resource Commons

Resource Commons 是参加 WAICY 的资源共享原型，面向学校、家庭与社区。它将物品登记、混合需求匹配、借用和归还流程放进同一套界面。库存、帖子、消息及模拟预约保存在当前浏览器中。示例照片和预置候选可用于演示拍照登记流程。

## 在本机运行

使用 Python 3.10 或更新版本。从仓库根目录运行：

```sh
RESOURCE_AI_BACKEND=local python3 -B outputs/local_ai/server.py
```

在浏览器中打开 [http://127.0.0.1:8765/prototype/](http://127.0.0.1:8765/prototype/)。也可以直接打开 `outputs/prototype/index.html` 体验静态版本。库存登记、规则匹配和示例照片无需模型或 API 密钥。

如需识别自己上传的照片，可在本机运行 Ollama，安装 `qwen3.5:4b`，再把 `RESOURCE_OLLAMA_URL` 指向本机 Ollama 服务，例如 `http://127.0.0.1:11434`。也可通过环境变量 `RESOURCE_AI_BACKEND=openai`、`OPENAI_API_KEY` 和 `RESOURCE_AI_MODEL` 配置 OpenAI 模式。该模式会将识别请求中的文字或压缩后的照片发送至配置的服务。

仓库提供浏览器原型及 Python 后端。实验用检测器权重、训练数据和竞赛提交材料单独保存。

## 测试

```sh
node --test outputs/prototype/*.test.js
RESOURCE_AI_BACKEND=local python3 -B -m unittest discover -s outputs/local_ai
```

## 图片来源

示例照片的作者、出处和许可见 [示例图片来源](outputs/prototype/assets/examples/sources.json) 和 [桌面照片来源](outputs/prototype/assets/demo/desk-source.json)。
