# 配置
## 前置模组
### 1. 脚本：JsMacros Reloaded 
  下载链接：[https://modrinth.com/mod/jsmacros-reloaded] \
  文档：[https://jsmacros.wagyourtail.xyz/?general.html] （文档版本1.8.4)
### 2. 寻路：Baritone 
  下载链接：[https://github.com/cabaletta/baritone] \
  文档：[https://baritone.leijurv.com] 
## Config
### 1. 背包槽位设置：
  0-8格为玩家物品栏、9-35格为背包栏\
  <span style="color:red;">使用脚本前请根据背包槽位设置清空背包</span>

| 名字 | 变量名 | 默认槽位 |
| :---: | :---: | --- |
| 铁桶 | IRON_BUCKET_SLOTS | [9, 10] |
| 水桶 | ZONE_SLOTS[1] | [11, 12, 13, 14, 15, 16, 17, 18] |
| 主料 | ZONE_SLOTS[2] | [19, 20, 21, 22, 23, 24, 25, 26] |
| 辅料1 | ZONE_SLOTS[3] | [27, 28, 29] |
| 辅料2 | ZONE_SLOTS[4] | [30, 31, 32] |
| 辅料3 | ZONE_SLOTS[5] | [33, 34, 35] |
### 2. 货箱位置设置：
  请填入货箱世界坐标（如IRON_BUCKET_CHEST = { x: 100, y: 70, z: -200}）
  <span style="color:red;">注意，货箱需为27格容器（如潜影盒、单格箱子）</span>

| 名字 | 变量名 |
| :---: | :---: |
| 铁桶 | IRON_BUCKET_CHEST |
| 水桶 | RESTOCK_CHESTS[1] |
| 主料 | RESTOCK_CHESTS[2] |
| 辅料1 | RESTOCK_CHESTS[3] |
| 辅料2 | RESTOCK_CHESTS[4] |
| 辅料3 | RESTOCK_CHESTS[5] |
### 3. 木桶扫描范围设置（区块）：
  变量名：SCAN_RANGE

# 使用方法
### 游戏内打开JsMacros（默认k键），进入按键页面，点击子页面右上角的+号
### 点任意文件，选择打开文件夹，并将酿酒脚本放入该文件夹
### 配置任意按键以激活，状态选择开启
### h键暂停，其可以记录当前酒桶状态，重启后可继续

# 声明
本项目开源，你可以自由使用、分发、修改，但仅供个人使用，不得用于商业用途
