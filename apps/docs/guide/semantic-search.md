# 语义检索

字面检索跨不过词汇鸿沟——搜"电话"找不到只写"手机号"的笔记。语义层是可选增强：**不配置或 API 不可用时自动降级纯字面，检索永远可用。**

## 开启

`.kb/config.json` 加一节：

```jsonc
"embedding": {
  "baseUrl": "https://api.siliconflow.cn/v1",   // 任何 OpenAI 兼容端点
  "model": "BAAI/bge-m3",
  "apiKeyEnv": "KB_EMBEDDING_API_KEY"            // 秘密的"名字"——config 进 git，key 本体见下
}
```

然后配 key、生成向量：

```bash
kb key set     # 粘贴一次（输入不回显），写入 .kb/secrets.json（0600，自动 gitignore）
kb index       # 按内容 hash 增量嵌入，没改过的笔记不重算
kb key test    # 随时验证 key 与向量覆盖率
```

## 配置与秘密分家

- `config.json` 进 git：系统怎么工作，可同步可复现
- `secrets.json` 永不进 git：你是谁

key 解析链：`环境变量（临时覆盖）→ .kb/secrets.json → 降级纯字面`。一处配置，CLI / MCP 门 / cron / hooks 全部生效。`kb doctor` 会做语义层体检，包括"secrets 误入 git"的事故检测。换 key 不用重算向量，换 **model** 才需要全量重嵌。

## 工作方式

查询时**字面三层 + 语义余弦双路召回**，RRF 融合排序（`Σ 1/(60+排名)`，只看排名不看分数尺度，无参数可调）。

字面三层逐级降级，用户零学习成本：整串连续命中 > 空格显式分词全命中 > 自动分词（中文按二字词切）按覆盖度与词权重排序——组合词即使从未连续出现过也能召回。

个人库规模下语义匹配走 JS 全量余弦，**无需任何向量数据库**。

## 容易踩的点

- **`managed` 收窄 ≠ `exclude`**。想让某目录（如 `daily/`）不受代谢管理但引用算反链，做法是收窄 `managed`；被 `exclude` 的文件连反链扫描都会跳过。
- **wiki 链接按完整文件名匹配**。`kb add` 生成的文件带日期前缀，手写 `[[链接]]` 用全名（Obsidian 自动补全默认就是全名）。
