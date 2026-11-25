# 发布与维护（dsh-session-digest）

## 状态

| 项 | 状态 |
|---|---|
| GitHub 仓库 | https://github.com/dengwei84/dsh-session-digest （Public，`dsh-plugin` topic） |
| npm | `dsh-session-digest`（首次发布待 2FA 验证） |
| 市场条目 PR | [#18721](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/18721)（open；仓库创建不满 1 天时 gate 失败，满 1 天后自动重跑） |
| 本机 profile | desktop profile 已装 0.1.0（本地目录链接） |

市场收录规则、gate 行为、`npm` 映射的来源，与 `dsh-workspace-tidy` 相同，见
`../dsh-workspace-tidy/PUBLISH.md`。要点：

- 条目文件 `data/plugins/<owner>__<repo>.yml`，一次 PR 只加一个文件，描述含「: 」必须加引号。
- 目录与 format-1 索引由 awesome-dsh-plugin 的每夜构建生成；npm 映射靠 `scripts/probe-npm.mjs` 读仓库 `package.json` + npm registry 的 `repository` 字段，所以**先发 npm 才会进索引**。
- 合并后网站与 dshmarket 自动更新；版本升级不需要再提 PR，nightly 会重新探测。

## 首次发布

1. 建仓库并推送（已完成）：

```powershell
git init -b main
git add -A; git commit -m "feat: cross-workspace session digest tools"
git remote add origin https://github.com/dengwei84/dsh-session-digest.git
git push -u origin main
```

2. 发布 npm（需要带 Bypass 2FA 的 granular token，或 `npm publish --otp=<6 位>`）：

```powershell
npm publish
```

3. 提市场条目 PR：fork `awesome-dsh-plugin/awesome-dsh-plugin`，在新分支加
   `data/plugins/dengwei84__dsh-session-digest.yml`（内容见本目录 `market-entry.yml` 的同类模板）。

## 后续升级版本

1. 改 `package.json` 的 `version`（SemVer），跑 `node --test test/session-digest.test.mjs`。
2. 提交并推送，打 tag：`git tag v0.1.1; git push --tags`。
3. `npm publish`（同上，需要 2FA）。
4. 本机升级：

```powershell
pnpm dsh plugin --profile desktop add dsh-session-digest@<version>
```

5. nightly 构建会把新版本写进市场目录与索引，无需改 PR 里的 YAML；只有改名称、分类、描述、图标时才需要再提一次 PR。

## 注意

- 不要把 npm token 写进仓库任何文件；发布用的 token 建议设置有效期，用完在 npmjs.com 吊销。
- npm 正在收紧「bypass 2FA token」的权限，长期方案是 trusted publishing（GitHub Actions OIDC）；迁移后本地不再需要 token。
