给你一套稳妥的步骤（把本地 `dev` 跟上游同步，再让功能分支跟上 `dev`，最后推到你自己的 fork）：

---
git remote add upstream https://github.com/sst/opencode.git

## 1) 同步远程引用

```bash
git fetch upstream
git fetch origin
```

## 2) 让本地 dev 跟上上游 dev

二选一（选你团队习惯）：

**方式 A：rebase（线性历史，可能需强推）**

```bash
git checkout dev
git rebase upstream/dev
# 解决冲突后：git rebase --continue
git push origin dev   # 如果你之前在 origin/dev 上有不同历史，可能需要：git push -f origin dev
```

**方式 B：merge（保留分叉历史，最安全）**

```bash
git checkout dev
git merge upstream/dev
git push origin dev
```


## 3) 让你的功能分支跟上最新 dev

同样二选一：

**rebase：**

```bash
git checkout feature/verilog-agent
git rebase dev
# 解决冲突 → git rebase --continue
git push -f origin feature/verilog-agent   # rebase 后通常需要 -f
```

**merge：**

```bash
git checkout feature/verilog-agent
git merge dev
git push origin feature/verilog-agent
```

---

## 小贴士

* 查看本地分支追踪关系（别和“remote 名字”混淆）：

  ```bash
  git branch -vv
  ```

  若需要，设置追踪：

  ```bash
  git branch --set-upstream-to=origin/dev dev
  ```
* 以后记住：

  * **`origin` / `upstream`** 是远程名；
  * **`origin/dev` / `upstream/dev`** 才是远程分支；
  * rebase/merge 要对齐到“分支”，不是“远程”。

如果你想，我可以根据你当前分支列表和追踪关系，给你生成一条**最短命令序列**（比如你更偏好 merge 还是 rebase）。
