# 🛡️ AI 怪物塔防戰（AI Monster Tower Defense）

結合 **2D 即時塔防** 與 **程式邏輯教學（變數、條件判斷、重複迴圈、函式）** 的多人連線網頁遊戲，內建**老師統一創房與即時觀戰控制台**，並嚴格隔離 **國一** 與 **國二** 房間，支援單人與雙人輪流模式。

---

## ✨ 核心功能

1. **學生兩步驟進入遊戲介面（`/`）**
   - **Step 1**：輸入老師給予的 **房號**、**暱稱**，並選擇 **年級（國一 / 國二）**。
   - **Step 2**：進入房間準備室確認隊友與任務簡報，點擊 **「下一步：準備進入戰場」** 後開戰。
2. **年級嚴格隔離與人數模式**
   - **國一房間** 與 **國二房間** 完全分開，跨年級輸入房號將被後端阻擋，無法共同遊玩。
   - 支援 **單人獨立挑戰（1 人）** 與 **雙人輪流合作（2 人輪替操作權 + 策略提示氣泡）**。
3. **Scratch 拖拉積木 × Python 即時高亮對照學習（專為學過 Scratch 的學生設計）**
   - **🟦 動作與武器 (`turret.move_to` / `turret.patrol` / `turret.set_weapon`)**：拖曳「移動砲塔」、「來回巡邏」積木追擊怪物，並切換 4 種特色武器（⚡ 雷射、❄️ 冰霜緩速彈、⛓️ 連鎖閃電、💥 等離子重砲）。
   - **🟧 變數 (`damage` / `fire_rate` / `attack_range`)**：用「將變數設為 (`=`)」與「將變數增加 (`+=`)」積木調配火力與攻速，底下同步高亮顯示 Python 變數賦值語法。
   - **🟨 條件判斷 (`if / elif / else`)**：拉入「如果 ＜條件＞ 那麼」與 `and / or` 積木專打護盾怪、重裝甲、快衝基地怪或 BOSS。
   - **🩷 重複迴圈 (`for`)**：拖曳「重複 N 次連發 (`range`)」或「掃描 N 隻同時打 (`targets[:N]`)」積木。
   - **🧩 函式積木 (`def`)**：把常用積木組存成「我的函式積木」並從其他砲塔一鍵呼叫，修改定義時同步升級多座砲塔。
   - **🐍 Python 即時發光對照視窗**：每次拖拉、編輯或移動 Scratch 積木時，下方 Python 程式碼對應的那幾行會同步發光並附中文教學註解！
4. **超豐富耐玩戰術玩法**
   - **🪙 金幣與指揮官技能**：打怪掉落金幣（含高速高賞金的「黃金寶藏史萊姆」），可發動 `☄️ 軌道雷射轟炸`、`🧊 全場 EMP 冰封`、`🛠️ 修復基地護盾`、`⚡ 算力核心擴容`。
   - **🌊 8 大波次 + 波次特殊詞綴 + 無盡生存模式**：包含幻影突襲、雙核護盾機甲與終極 Omega BOSS；破關後可一鍵繼續挑戰「🔥 無盡生存模式」，累積連擊 Combo 與戰場成就徽章！
5. **老師統一創房與即時觀戰控制台（`/teacher`）**
   - 一鍵建立「國一雙人合作房 + 國二單人挑戰房」或自訂房間。
   - 依年級分區顯示所有教室的即時縮圖戰場、學生連線/回合狀態、4 項程式觀念達成度。
   - 點擊「放大觀戰」可看全尺寸即時畫面、學生調整紀錄、發送課堂廣播提示、暫停或重置戰場。

---

## 🚀 本機開發與測試

```bash
# 安裝套件
npm install

# 執行自動化測試
npm test

# 啟動伺服器（預設 Port 3000，教師預設密碼 1234）
npm start
```

- 學生端網址：`http://localhost:3000/`
- 老師端網址：`http://localhost:3000/teacher`

---

## 🌐 上傳 GitHub 與部署到 Render

專案已內建 [`render.yaml`](./render.yaml) 與 `/health` 健康檢查端點。

### 1. 推送程式碼到 GitHub
```bash
git init
git add .
git commit -m "Initial commit: AI Monster Tower Defense"
git branch -M main
git remote add origin https://github.com/<你的帳號>/<你的Repo名稱>.git
git push -u origin main
```

### 2. 上架到 Render
1. 登入 [Render Dashboard](https://dashboard.render.com/)，點擊 **New + → Web Service**（或 **Blueprint** 直接讀取 `render.yaml`）。
2. 連接你的 GitHub 帳號並選擇此 Repository。
3. 確認設定：
   - **Environment / Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Health Check Path**: `/health`
4. 在 **Environment Variables** 新增：
   - `TEACHER_PIN` = 你要設定的老師登入密碼（勿使用預設 `1234`）
5. 點擊 **Deploy Web Service**，完成後即可取得公開 HTTPS 網址發給學生使用！

