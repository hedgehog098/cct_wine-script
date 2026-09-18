// ==================== 配置区 ====================
// 停止键位
const STOP_KEY = "h";

// 玩家背包槽位配置
const IRON_BUCKET_SLOTS = [9, 10];   // 铁桶

const ZONE_SLOTS = {
    1: [11, 12, 13, 14, 15, 16, 17, 18],// 水桶
    2: [19, 20, 21, 22, 23, 24, 25, 26],// 主料
    3: [27, 28, 29], //辅料1
    4: [30, 31, 32], //辅料2
    5: [33, 34, 35]  //辅料3
};

//补货、放空桶对应容器位置坐标设置 注意!其需为27格容器!
const RESTOCK_CHESTS = {
    1: { x: 79417, y: 70, z: -38391 }, // 水桶
    2: { x: 79415, y: 71, z: -38389 }, // 主料
    3: { x: 79415, y: 70, z: -38394 }, // 辅料1
    4: { x: 79415, y: 70, z: -38395 }, // 辅料2
    5: { x: 79415, y: 70, z: -38396 }  // 辅料3
};
const IRON_BUCKET_CHEST = { x: 79414, y: 72, z: -38392 };

// 木桶扫描范围（区块）
const SCAN_RANGE = 3;

// 酿酒页面索引
const ZONE_TARGET_SLOTS = {
    1: 19,
    2: 21,
    3: 23,
    4: 24,
    5: 25
};
const FINAL_CLICK_SLOT = 49;

const PATH_TIMEOUT_TICKS = 600;  // 寻路最长等待时间（约30秒）

// ---- 木桶任务缓存文件 ----
const BARREL_CACHE_FILE = "config/barrel_task_cache.json";
const BARREL_STATE_PENDING = "pending";
const BARREL_STATE_COMPLETED = "completed";
const BARREL_STATE_DONE = "done";

// ---- 容器尺寸常量 ----
// 补货容器 / 铁桶容器：27 格小箱子，总槽位 = 27 + 36 = 63
const RESTOCK_CONTAINER_SIZE = 27;
const RESTOCK_TOTAL_SLOTS = RESTOCK_CONTAINER_SIZE + 36;

// 工作木桶：54 格木桶，总槽位 = 54 + 36 = 90
const BARREL_CONTAINER_SIZE = 54;
const BARREL_TOTAL_SLOTS = BARREL_CONTAINER_SIZE + 36;

// 兼容旧变量名
const CONTAINER_SIZE = BARREL_CONTAINER_SIZE;      // 54
const GET_CONTAINER_SIZE = RESTOCK_CONTAINER_SIZE; // 27
const PLAYER_INVENTORY_SIZE = 46;
const EXPECTED_TOTAL_SLOTS = BARREL_TOTAL_SLOTS;   // 90

// ==================== Java 类型导入 ====================
const BaritoneAPI = Java.type("baritone.api.BaritoneAPI");
const GoalBlock = Java.type("baritone.api.pathing.goals.GoalBlock");
const GoalNear = Java.type("baritone.api.pathing.goals.GoalNear");
const GoalGetToBlock = Java.type("baritone.api.pathing.goals.GoalGetToBlock");
const BlockPos = Java.type("net.minecraft.core.BlockPos");

const Files = Java.type("java.nio.file.Files");
const Paths = Java.type("java.nio.file.Paths");
const StandardCharsets = Java.type("java.nio.charset.StandardCharsets");
const JavaString = Java.type("java.lang.String");

// ==================== Baritone 设置 ====================
function configureBaritone() {
    try {
        const settings = BaritoneAPI.getSettings();
        settings.allowBreak.value = false;
        settings.allowPlace.value = false;
    } catch (e) {
        Chat.log("§c设置 Baritone 参数时出错: " + e);
    }
}

// ==================== 强制退出 ====================
let stopRequested = false;

const KeyBind = Java.type("net.minecraft.client.KeyMapping");

// ---- 强制退出键位解析 ----
function resolveStopKey(raw) {
    if (!raw) return "key.keyboard.h";
    const s = String(raw).trim().toLowerCase();
    if (s.startsWith("key.")) return s;
    if (s.length === 1) return "key.keyboard." + s;

    const specialMap = {
        "esc": "key.keyboard.escape",
        "escape": "key.keyboard.escape",
        "space": "key.keyboard.space",
        "enter": "key.keyboard.enter",
        "tab": "key.keyboard.tab",
        "shift": "key.keyboard.left.shift",
        "ctrl": "key.keyboard.left.control",
        "alt": "key.keyboard.left.alt",
        "delete": "key.keyboard.delete",
        "backspace": "key.keyboard.backspace",
        "up": "key.keyboard.up",
        "down": "key.keyboard.down",
        "left": "key.keyboard.left",
        "right": "key.keyboard.right",
        "end": "key.keyboard.end",
        "home": "key.keyboard.home",
        "insert": "key.keyboard.insert",
        "pageup": "key.keyboard.page.up",
        "pagedown": "key.keyboard.page.down"
    };

    if (specialMap[s]) return specialMap[s];
    return "key.keyboard." + s;
}

const STOP_KEY_RESOLVED = resolveStopKey(STOP_KEY);

var keyEvent = JsMacros.on("Key", JavaWrapper.methodToJava((e) => {
    if (e.key == STOP_KEY_RESOLVED && e.action == 1) {
        stopRequested = true;
        Chat.log("§c收到强制退出信号，正在停止...");
    }
}));

// ==================== 槽位转换工具 ====================
function playerSlotToWindowSlotWithSize(playerSlot, containerSize) {
    if (playerSlot >= 9 && playerSlot <= 35) {
        return playerSlot - 9 + containerSize;
    }
    if (playerSlot >= 36 && playerSlot <= 44) {
        return playerSlot - 36 + containerSize + 27;
    }
    return playerSlot;
}

function playerSlotsToWindowSlots_27(playerSlots) {
    return playerSlots.map(s => playerSlotToWindowSlotWithSize(s, RESTOCK_CONTAINER_SIZE));
}

function playerSlotsToWindowSlots_54(playerSlots) {
    return playerSlots.map(s => playerSlotToWindowSlotWithSize(s, BARREL_CONTAINER_SIZE));
}

// ==================== 状态记录 ====================
let savedLocation = null;
let allBarrels = [];
let barrelTasks = [];
let pendingBarrels = [];
let completedBarrels = [];
let doneBarrels = [];
let shutdownEvent = null;
let disconnectEvent = null;

// ==================== 文件缓存 ====================
function fileExists(path) {
    return Files.exists(Paths.get(path));
}

function writeStringToFile(path, text) {
    const p = Paths.get(path);
    const parent = p.getParent();
    if (parent) Files.createDirectories(parent);

    const writer = Files.newBufferedWriter(p, StandardCharsets.UTF_8);
    try {
        writer.write("" + text);   // 强制转成 JS 字符串，再由 GraalJS 自动转 Java String
    } finally {
        writer.close();
    }
}

function readStringFromFile(path) {
    const reader = Files.newBufferedReader(Paths.get(path), StandardCharsets.UTF_8);
    let result = "";
    try {
        let line;
        let first = true;
        while ((line = reader.readLine()) !== null) {
            if (!first) result += "\n";
            result += "" + line;
            first = false;
        }
    } finally {
        reader.close();
    }
    return result;
}

function deleteFileIfExists(path) {
    try {
        return Files.deleteIfExists(Paths.get(path));
    } catch (e) {
        return false;
    }
}

function saveBarrelTasks() {
    try {
        if (!barrelTasks || barrelTasks.length === 0) return;

        const data = {
            version: 1,
            savedAt: Date.now(),
            scanRange: SCAN_RANGE,
            barrels: barrelTasks
        };

        writeStringToFile(BARREL_CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        Chat.log("§c保存木桶缓存失败: " + e);
    }
}

function loadBarrelTasksFromFile() {
    if (!fileExists(BARREL_CACHE_FILE)) return null;

    try {
        const text = readStringFromFile(BARREL_CACHE_FILE);
        const data = JSON.parse(text);

        if (!data || !Array.isArray(data.barrels)) return null;

        const tasks = data.barrels
            .map((b, i) => ({
                index: typeof b.index === "number" ? b.index : i,
                x: b.x,
                y: b.y,
                z: b.z,
                state: b.state || BARREL_STATE_PENDING
            }))
            .filter(b =>
                Number.isFinite(b.x) &&
                Number.isFinite(b.y) &&
                Number.isFinite(b.z)
            );

        return tasks.length > 0 ? tasks : null;
    } catch (e) {
        Chat.log("§c读取木桶缓存失败: " + e);
        return null;
    }
}

function deleteBarrelCache() {
    try {
        if (deleteFileIfExists(BARREL_CACHE_FILE)) {
            Chat.log("§a已删除木桶缓存文件。");
        }
    } catch (e) {
        Chat.log("§c删除木桶缓存失败: " + e);
    }
}

function createBarrelTasksFromScan(barrels) {
    return barrels.map((pos, i) => ({
        index: i,
        x: pos.getX(),
        y: pos.getY(),
        z: pos.getZ(),
        state: BARREL_STATE_PENDING
    }));
}

// 意外退出 / 断开连接前尽量保存
try {
    shutdownEvent = JsMacros.on("ClientShutdown", JavaWrapper.methodToJava(() => {
        if (barrelTasks && barrelTasks.length > 0) saveBarrelTasks();
    }));
} catch (e) {}

try {
    disconnectEvent = JsMacros.on("Disconnect", JavaWrapper.methodToJava(() => {
        if (barrelTasks && barrelTasks.length > 0) saveBarrelTasks();
    }));
} catch (e) {}

// ==================== Baritone 寻路封装 ====================
function getBaritone() {
    return BaritoneAPI.getProvider().getPrimaryBaritone();
}

function getPlayerContext() {
    return getBaritone().getPlayerContext();
}

function goToBlock(x, y, z, timeoutTicks) {
    timeoutTicks = timeoutTicks || PATH_TIMEOUT_TICKS;
    const baritone = getBaritone();

    baritone.getCustomGoalProcess().setGoalAndPath(new GoalBlock(x, y, z));

    for (let i = 0; i < timeoutTicks; i++) {
        if (stopRequested) {
            getBaritone().getPathingBehavior().cancelEverything();
            return false;
        }
        Client.waitTick(5);
        if (!baritone.getCustomGoalProcess().isActive()) {
            return true;
        }
    }

    baritone.getPathingBehavior().cancelEverything();
    return false;
}

function goToNear(x, y, z, range, timeoutTicks) {
    range = range || 2;
    timeoutTicks = timeoutTicks || PATH_TIMEOUT_TICKS;
    const baritone = getBaritone();

    baritone.getCustomGoalProcess().setGoalAndPath(new GoalNear(new BlockPos(x, y, z), range));

    for (let i = 0; i < timeoutTicks; i++) {
        if (stopRequested) {
            getBaritone().getPathingBehavior().cancelEverything();
            return false;
        }
        Client.waitTick(5);
        if (!baritone.getCustomGoalProcess().isActive()) {
            return true;
        }
    }

    baritone.getPathingBehavior().cancelEverything();
    return false;
}

function stopBaritone() {
    getBaritone().getPathingBehavior().cancelEverything();
}

// ==================== 扫描木桶 ====================
function scanBarrels(range) {
    const provider = BaritoneAPI.getProvider();
    const scanner = provider.getWorldScanner();
    const ctx = getPlayerContext();

    const BlockOptionalMetaLookup = Java.type("baritone.api.utils.BlockOptionalMetaLookup");
    const filter = new BlockOptionalMetaLookup("minecraft:barrel");
    const javaList = scanner.scanChunkRadius(ctx, filter, -1, -1, range);

    const result = [];
    for (let i = 0; i < javaList.size(); i++) {
        result.push(javaList.get(i));
    }
    return result;
}

// ==================== 工具函数 ====================
function safeGetSlot(inv, slot) {
    if (!inv || slot < 0 || slot >= inv.getTotalSlots()) return null;
    return inv.getSlot(slot);
}

function isZoneEmpty(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (item && !item.isEmpty()) return false;
    }
    return true;
}

function getFirstNonEmptySlot(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (item && !item.isEmpty()) return slot;
    }
    return -1;
}

function getFirstEmptySlot(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) return slot;
    }
    return -1;
}

function isZoneFull(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) return false;
    }
    return true;
}

function countEmptySlots(inv, slotList) {
    let count = 0;
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) count++;
    }
    return count;
}

function isPlayerInventoryOnly(inv, expectedTotalSlots) {
    if (!inv) return true;
    return inv.getTotalSlots() === 46;
}

function waitForContainerOpen(expectedTotalSlots, timeoutTicks) {
    timeoutTicks = timeoutTicks || 20;
    for (let i = 0; i < timeoutTicks; i++) {
        const inv = Player.openInventory();
        if (inv && inv.getTotalSlots() >= expectedTotalSlots) {
            return inv;
        }
        Client.waitTick(1);
    }
    return null;
}

// ==================== 位置记录与恢复 ====================
function savePlayerState() {
    const player = Player.getPlayer();
    const pos = player.getPos();
    savedLocation = {
        x: pos.x, y: pos.y, z: pos.z,
        yaw: player.getYaw(),
        pitch: player.getPitch()
    };
}

function restorePlayerState() {
    if (!savedLocation) return;

    goToNear(
        Math.floor(savedLocation.x),
        Math.floor(savedLocation.y),
        Math.floor(savedLocation.z),
        2
    );

    const player = Player.getPlayer();
    player.lookAt(savedLocation.x, savedLocation.y + player.getEyeHeight(), savedLocation.z);
    Client.waitTick(2);
    savedLocation = null;
}

// ==================== 移动与交互 ====================
function moveToBlock(blockX, blockY, blockZ) {
    return goToNear(blockX, blockY, blockZ, 2);
}

function getLookedAtBlock(maxDistance) {
    maxDistance = maxDistance || 6;
    const player = Player.getPlayer();
    const hit = player.rayTraceBlock(maxDistance, false);
    if (!hit) return null;
    return hit.getBlockPos();
}

function isSameBlockPos(pos, x, y, z) {
    if (!pos) return false;
    return pos.getX() === x && pos.getY() === y && pos.getZ() === z;
}

function randomMove() {
    const player = Player.getPlayer();
    const pos = player.getPos();
    const dx = (Math.random() - 0.5) * 4;
    const dz = (Math.random() - 0.5) * 4;
    const targetX = Math.floor(pos.x + dx);
    const targetZ = Math.floor(pos.z + dz);
    const targetY = Math.floor(pos.y);

    goToNear(targetX, targetY, targetZ, 1, 60);
}

// ==================== 打开容器 ====================
// 只负责：寻路到目标附近 + 对准，直到射线命中目标方块
// 射线未命中时：随机走 + 重新寻路
// 返回值：true = 射线已确认目标；false = 被强制停止
// 只负责：寻路到目标附近 + 对准，直到射线命中目标方块
// 策略：
//   - 常规：goToNear(target, 3) 靠近目标
//   - 每次未命中：randomMove + 立即 lookAt + rayTrace
//   - 每 15 次随机移动后：goToNear(target, 1) 强制拉近一次，避免越走越远
// 返回值：true = 射线已确认目标；false = 被强制停止
function ensureRayOnTarget(blockX, blockY, blockZ, maxRayAttempts) {
    maxRayAttempts = maxRayAttempts || 0; // 0 = 无限
    let attempts = 0;
    let randomMoveCount = 0;              // 随机移动计数器
    const CLOSE_EVERY = 15;               // 每 15 次随机移动强制拉近一次

    while (!stopRequested) {
        attempts++;
        if (maxRayAttempts > 0 && attempts > maxRayAttempts) {
            return false;
        }

        // 寻路到目标附近（初次 / 拉近后回到这里）
        if (!goToNear(blockX, blockY, blockZ, 3)) {
            if (stopRequested) return false;
            randomMove();
            randomMoveCount++;
            if (randomMoveCount >= CLOSE_EVERY) {
                randomMoveCount = 0;
                goToNear(blockX, blockY, blockZ, 1);
            }
            continue;
        }
        Client.waitTick(3);

        // 对准目标
        const player = Player.getPlayer();
        player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
        Client.waitTick(3);

        // 射线检测
        const looked = getLookedAtBlock(6);
        if (isSameBlockPos(looked, blockX, blockY, blockZ)) {
            return true;
        }

        // 未命中：随机走
        if (stopRequested) return false;
        randomMove();
        randomMoveCount++;
        Client.waitTick(3);

        // 随机移动后立即对准并再次射线检测，命中直接返回
        player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
        Client.waitTick(2);

        const lookedAfterMove = getLookedAtBlock(6);
        if (isSameBlockPos(lookedAfterMove, blockX, blockY, blockZ)) {
            return true;
        }

        // 每 15 次随机移动，强制拉近一次
        if (randomMoveCount >= CLOSE_EVERY) {
            randomMoveCount = 0;
            if (stopRequested) return false;

            //Chat.log(`§7已随机移动 ${CLOSE_EVERY} 次未命中，强制拉近目标 (${blockX}, ${blockY}, ${blockZ})`);
            goToNear(blockX, blockY, blockZ, 1);
            Client.waitTick(3);

            // 拉近后立即再次射线检测，命中直接返回
            player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
            Client.waitTick(2);

            const lookedAfterClose = getLookedAtBlock(6);
            if (isSameBlockPos(lookedAfterClose, blockX, blockY, blockZ)) {
                return true;
            }
        }
    }

    return false;
}

// 返回值：
//   Inventory -> 成功打开目标容器
//   null      -> 暂时失败
//   "DONE"    -> 交互无反应，仅打开玩家栏（仅 allowDoneDetection=true 时）
function openBlockInventory(blockX, blockY, blockZ, maxRetries, allowDoneDetection, expectedTotalSlots) {
    maxRetries = maxRetries || 5;
    allowDoneDetection = allowDoneDetection === true;
    expectedTotalSlots = expectedTotalSlots || BARREL_TOTAL_SLOTS;
    let playerInventoryOnlyCount = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (stopRequested) return null;

        if (!ensureRayOnTarget(blockX, blockY, blockZ, 0)) {
            return null; // 确认射线
        }

        const player = Player.getPlayer();
        player.interact();
        const inv = waitForContainerOpen(expectedTotalSlots, 20);

        if (!inv || isPlayerInventoryOnly(inv, expectedTotalSlots)) {
            if (stopRequested) return null;

            const lookedNow = getLookedAtBlock(6);
            if (!isSameBlockPos(lookedNow, blockX, blockY, blockZ)) {
                if (inv) inv.close();
                Client.waitTick(2);
                randomMove();
                player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
                continue;
            }

            // 射线检测目标正确：不再随机走，只重新对准并重试
            if (!allowDoneDetection) {
                if (inv) inv.close();
                Client.waitTick(2);
                player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
                Client.waitTick(3);
                continue;
            }

            playerInventoryOnlyCount++;

            if (inv) inv.close();
            Client.waitTick(2);

            if (playerInventoryOnlyCount >= 2) {
                return "DONE";
            }

            player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
            Client.waitTick(3);
            continue;
        }

        const lookedAfter = getLookedAtBlock(6);
        if (!isSameBlockPos(lookedAfter, blockX, blockY, blockZ)) {
            if (stopRequested) return null;
            inv.close();
            Client.waitTick(2);
            randomMove();
            continue;
        }

        return inv;
    }

    return null;
}

// 补货专用：未打开就随机走 + 重新寻路，直到打开或强制退出
function openBlockInventoryForRestock(blockX, blockY, blockZ, expectedTotalSlots) {
    expectedTotalSlots = expectedTotalSlots || RESTOCK_TOTAL_SLOTS;
    let attempts = 0;

    while (!stopRequested) {
        attempts++;

        const inv = openBlockInventory(blockX, blockY, blockZ, 1, false, expectedTotalSlots);
        if (inv && inv !== "DONE") {
            return inv;
        }

        abortIfStopped();
        Chat.log(`§e补货容器未打开，随机移动后重新寻路重试（第 ${attempts} 次）...`);
        randomMove();
        Client.waitTick(3);
    }

    return null;
}

// ==================== 补货逻辑 ====================
function putIronBucketsIntoChest() {
    abortIfStopped();

    const cx = IRON_BUCKET_CHEST.x;
    const cy = IRON_BUCKET_CHEST.y;
    const cz = IRON_BUCKET_CHEST.z;

    const invCheck = Player.openInventory();
    const playerWindowSlots = playerSlotsToWindowSlots_27(IRON_BUCKET_SLOTS);
    let hasBucket = false;

    for (let ws of playerWindowSlots) {
        const item = safeGetSlot(invCheck, ws);
        if (item && !item.isEmpty()) {
            hasBucket = true;
            break;
        }
    }

    invCheck.close();
    Client.waitTick(2);
    
    /*
    if (!hasBucket) {
        return true;
    }*/

    if (!moveToBlock(cx, cy, cz)) {
        abortIfStopped();
        Chat.log(`§c无法到达铁桶容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }
    Client.waitTick(3);

    const inv = openBlockInventoryForRestock(cx, cy, cz, RESTOCK_TOTAL_SLOTS);
    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开铁桶容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }

    let movedAny = false;

    for (let windowSlot of playerWindowSlots) {
        abortIfStopped();

        const item = safeGetSlot(inv, windowSlot);
        if (!item || item.isEmpty()) continue;

        let targetSlot = -1;
        for (let c = 0; c < RESTOCK_CONTAINER_SIZE; c++) {
            const cItem = safeGetSlot(inv, c);
            if (!cItem || cItem.isEmpty()) {
                targetSlot = c;
                break;
            }
        }

        if (targetSlot === -1) {
            Chat.log("§e铁桶容器已满，停止放入。");
            break;
        }

        inv.quick(windowSlot);
        Client.waitTick(3);
        movedAny = true;
    }

    inv.close();
    Client.waitTick(2);

    return true;
}

// 对指定区补货（27 格小箱子）
// 注意：此函数只负责补货，不再负责放铁桶
function restockZone(zoneId) {
    abortIfStopped();

    const chestPos = RESTOCK_CHESTS[zoneId];
    if (!chestPos) {
        Chat.log(`§c区 ${zoneId} 没有配置补货容器坐标。`);
        return false;
    }

    const cx = chestPos.x, cy = chestPos.y, cz = chestPos.z;

    if (!moveToBlock(cx, cy, cz)) {
        abortIfStopped();
        Chat.log(`§c无法到达区 ${zoneId} 的补货容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }
    Client.waitTick(3);

    const inv = openBlockInventoryForRestock(cx, cy, cz, RESTOCK_TOTAL_SLOTS);
    Client.waitTick(3);

    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开区 ${zoneId} 的补货容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }

    const playerSlotList = ZONE_SLOTS[zoneId];
    const windowSlotList = playerSlotsToWindowSlots_27(playerSlotList);

    let movedAny = false;

    for (let containerSlot = 0; containerSlot < RESTOCK_CONTAINER_SIZE; containerSlot++) {
        abortIfStopped();

        if (isZoneFull(inv, windowSlotList)) break;

        const item = safeGetSlot(inv, containerSlot);
        if (item && !item.isEmpty()) {
            const targetWindowSlot = getFirstEmptySlot(inv, windowSlotList);
            if (targetWindowSlot === -1) break;

            inv.click(containerSlot, 0);
            Client.waitTick(3);
            inv.click(targetWindowSlot, 0);
            Client.waitTick(3);
            movedAny = true;
        }
    }

    const full = isZoneFull(inv, windowSlotList);
    const emptyCount = countEmptySlots(inv, windowSlotList);

    inv.close();
    Client.waitTick(2);

    if (!movedAny) {
        Chat.log(`§c区 ${zoneId} 的补货容器里没有可用物品。`);
        return false;
    }

    if (!full) {
        Chat.log(`§e区 ${zoneId} 未补满，还缺 ${emptyCount} 个槽位。`);
    }

    // 不再在这里放铁桶，改由 restockAllEmptyZones 统一处理
    return full;
}

// 1、2 区绑定补货；只有本次包含 1、2 区时，补完后统一放一次铁桶
function restockAllEmptyZones(emptyZones) {
    // 1、2 区绑定：只要有一个为空，两个都补
    const zonesToRestock = [...emptyZones];
    const need12 = emptyZones.includes(1) || emptyZones.includes(2);

    if (need12) {
        if (!zonesToRestock.includes(1)) zonesToRestock.push(1);
        if (!zonesToRestock.includes(2)) zonesToRestock.push(2);
    }

    // 排序，让补货顺序自然一点：1、2、3、4、5
    zonesToRestock.sort((a, b) => a - b);

    let allSuccess = true;
    for (let zoneId of zonesToRestock) {
        abortIfStopped();
        if (!restockZone(zoneId)) {
            allSuccess = false;
        }
        Client.waitTick(3);
    }

    // 只有这次补货包含 1、2 区时，才放一次铁桶
    if (need12) {
        abortIfStopped();
        putIronBucketsIntoChest();
    }

    return allSuccess;
}

// ==================== 核心工作逻辑 ====================
// 返回值：
//   true     -> 正常完成
//   "DONE"   -> 木桶已完成（交互无反应）
//   false    -> 暂时失败，可重试
function processBarrel(task) {
    abortIfStopped();

    const bx = task.x;
    const by = task.y;
    const bz = task.z;

    if (!moveToBlock(bx, by, bz)) {
        abortIfStopped();
        Chat.log(`§c无法到达木桶 (${bx}, ${by}, ${bz})`);
        return false;
    }
    Client.waitTick(5);

    let inv = openBlockInventory(bx, by, bz, 5, true, BARREL_TOTAL_SLOTS);

    if (inv === "DONE") {
        return "DONE";
    }

    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开木桶 (${bx}, ${by}, ${bz})`);
        return false;
    }

    let emptyZones = [];
    for (let zoneId in ZONE_SLOTS) {
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        if (isZoneEmpty(inv, windowSlots)) {
            emptyZones.push(parseInt(zoneId));
        }
    }

    if (emptyZones.length > 0) {
        inv.close();
        Client.waitTick(2);

        savePlayerState();
        const restockOk = restockAllEmptyZones(emptyZones);
        abortIfStopped();
        restorePlayerState();
        Client.waitTick(3);

        inv = openBlockInventory(bx, by, bz, 5, true, BARREL_TOTAL_SLOTS);

        if (inv === "DONE") {
            return "DONE";
        }

        if (!inv) {
            abortIfStopped();
            Chat.log(`§c补货后无法重新打开木桶 (${bx}, ${by}, ${bz})`);
            return false;
        }

        let stillEmpty = [];
        for (let zoneId in ZONE_SLOTS) {
            const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
            if (isZoneEmpty(inv, windowSlots)) {
                stillEmpty.push(parseInt(zoneId));
            }
        }

        if (stillEmpty.length > 0) {
            inv.close();
            Client.waitTick(2);
            return false;
        }
    }

    // 装填木桶：1、2 区整组移动
    for (let zoneId of [1, 2]) {
        abortIfStopped();
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        let srcSlot = getFirstNonEmptySlot(inv, windowSlots);
        if (srcSlot !== -1) {
            const dstSlot = ZONE_TARGET_SLOTS[zoneId];
            inv.click(srcSlot, 0);
            Client.waitTick(3);
            inv.click(dstSlot, 0);
            Client.waitTick(3);
        }
    }

    // 装填木桶：3、4、5 区单个移动
    for (let zoneId of [3, 4, 5]) {
        abortIfStopped();
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        let srcSlot = getFirstNonEmptySlot(inv, windowSlots);
        if (srcSlot !== -1) {
            const dstSlot = ZONE_TARGET_SLOTS[zoneId];
            inv.click(srcSlot, 0);
            Client.waitTick(3);
            inv.click(dstSlot, 1);
            Client.waitTick(3);
            inv.click(srcSlot, 0);
            Client.waitTick(3);
        }
    }

    inv.click(FINAL_CLICK_SLOT);
    Client.waitTick(2);

    inv.close();
    Client.waitTick(2);
    return true;
}

// ==================== 主流程 ====================
function main() {
    try {
        configureBaritone();

        const loaded = loadBarrelTasksFromFile();

        if (loaded && loaded.length > 0) {
            barrelTasks = loaded;
            Chat.log(`§a从缓存文件读取 ${barrelTasks.length} 个木桶任务，跳过扫描。`);
        } else {
            Chat.log(`§e正在扫描周围 ${SCAN_RANGE} 区块内的木桶...`);

            allBarrels = scanBarrels(SCAN_RANGE);

            if (allBarrels.length === 0) {
                Chat.log("§c附近没有找到任何木桶。");
                return;
            }

            barrelTasks = createBarrelTasksFromScan(allBarrels);
            saveBarrelTasks();

            Chat.log(`§a找到 ${barrelTasks.length} 个木桶，已写入缓存，开始处理。`);
        }

        pendingBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_PENDING);
        completedBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_COMPLETED);
        doneBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_DONE);

        let failCount = 0;

        while (pendingBarrels.length > 0) {
            abortIfStopped();

            savePlayerState();

            const task = pendingBarrels[0];
            const bx = task.x, by = task.y, bz = task.z;

            const result = processBarrel(task);

            abortIfStopped();

            if (result === "DONE") {
                task.state = BARREL_STATE_DONE;
                completedBarrels.push(pendingBarrels.shift());
                doneBarrels.push(task);
                failCount = 0;
            } else if (result === true) {
                task.state = BARREL_STATE_COMPLETED;
                completedBarrels.push(pendingBarrels.shift());
                failCount = 0;
            } else {
                pendingBarrels.push(pendingBarrels.shift());
                failCount++;

                if (failCount >= pendingBarrels.length) {
                    Chat.log("§c所有木桶都无法处理，退出。");
                    saveBarrelTasks();
                    break;
                }
            }

            saveBarrelTasks();
            Client.waitTick(5);
        }

        const hasPending = barrelTasks.some(t => t.state === BARREL_STATE_PENDING);

        if (!hasPending) {
            deleteBarrelCache();
            Chat.log(`§a所有任务完成，共处理 ${barrelTasks.length} 个木桶。`);
        } else {
            saveBarrelTasks();
            Chat.log("§e仍有未完成木桶，缓存已保存。");
        }

    } catch (e) {
        if (e && e.message === "STOP_REQUESTED") {
            Chat.log("§c已中断，退出主流程。");
        } else {
            Chat.log("§c主流程异常: " + e);
        }

        saveBarrelTasks();

    } finally {
        stopBaritone();

        if (barrelTasks && barrelTasks.some(t => t.state === BARREL_STATE_PENDING)) {
            saveBarrelTasks();
        }

        const finished = barrelTasks.filter(t => t.state !== BARREL_STATE_PENDING).length;
        const doneCount = barrelTasks.filter(t => t.state === BARREL_STATE_DONE).length;

        Chat.log(`§a流程结束，共处理 ${finished} 个木桶（其中 ${doneCount} 个判定为已完成）。`);
    }
}

// 启动
main();
// ---- 木桶任务缓存文件 ----
const BARREL_CACHE_FILE = "config/barrel_task_cache.json";
const BARREL_STATE_PENDING = "pending";
const BARREL_STATE_COMPLETED = "completed";
const BARREL_STATE_DONE = "done";

// ---- 容器尺寸常量 ----
// 补货容器 / 铁桶容器：27 格小箱子，总槽位 = 27 + 36 = 63
const RESTOCK_CONTAINER_SIZE = 27;
const RESTOCK_TOTAL_SLOTS = RESTOCK_CONTAINER_SIZE + 36;

// 工作木桶：54 格木桶，总槽位 = 54 + 36 = 90
const BARREL_CONTAINER_SIZE = 54;
const BARREL_TOTAL_SLOTS = BARREL_CONTAINER_SIZE + 36;

// 兼容旧变量名
const CONTAINER_SIZE = BARREL_CONTAINER_SIZE;      // 54
const GET_CONTAINER_SIZE = RESTOCK_CONTAINER_SIZE; // 27
const PLAYER_INVENTORY_SIZE = 46;
const EXPECTED_TOTAL_SLOTS = BARREL_TOTAL_SLOTS;   // 90

// ==================== Java 类型导入 ====================
const BaritoneAPI = Java.type("baritone.api.BaritoneAPI");
const GoalBlock = Java.type("baritone.api.pathing.goals.GoalBlock");
const GoalNear = Java.type("baritone.api.pathing.goals.GoalNear");
const GoalGetToBlock = Java.type("baritone.api.pathing.goals.GoalGetToBlock");
const BlockPos = Java.type("net.minecraft.core.BlockPos");

const Files = Java.type("java.nio.file.Files");
const Paths = Java.type("java.nio.file.Paths");
const StandardCharsets = Java.type("java.nio.charset.StandardCharsets");
const JavaString = Java.type("java.lang.String");

// ==================== Baritone 设置 ====================
function configureBaritone() {
    try {
        const settings = BaritoneAPI.getSettings();
        settings.allowBreak.value = false;
        settings.allowPlace.value = false;
    } catch (e) {
        Chat.log("§c设置 Baritone 参数时出错: " + e);
    }
}

// ==================== 强制退出 ====================
let stopRequested = false;

const KeyBind = Java.type("net.minecraft.client.KeyMapping");
var keyEvent = JsMacros.on("Key", JavaWrapper.methodToJava((e) => {
    if (e.key == "key.keyboard.h" && e.action == 1) {
        stopRequested = true;
        Chat.log("§c收到强制退出信号，正在停止...");
    }
}));

function abortIfStopped() {
    if (stopRequested) {
        try { getBaritone().getPathingBehavior().cancelEverything(); } catch (e) {}
        throw new Error("STOP_REQUESTED");
    }
}

// ==================== 槽位转换工具 ====================
function playerSlotToWindowSlotWithSize(playerSlot, containerSize) {
    if (playerSlot >= 9 && playerSlot <= 35) {
        return playerSlot - 9 + containerSize;
    }
    if (playerSlot >= 36 && playerSlot <= 44) {
        return playerSlot - 36 + containerSize + 27;
    }
    return playerSlot;
}

function playerSlotsToWindowSlots_27(playerSlots) {
    return playerSlots.map(s => playerSlotToWindowSlotWithSize(s, RESTOCK_CONTAINER_SIZE));
}

function playerSlotsToWindowSlots_54(playerSlots) {
    return playerSlots.map(s => playerSlotToWindowSlotWithSize(s, BARREL_CONTAINER_SIZE));
}

// ==================== 状态记录 ====================
let savedLocation = null;
let allBarrels = [];
let barrelTasks = [];
let pendingBarrels = [];
let completedBarrels = [];
let doneBarrels = [];
let shutdownEvent = null;
let disconnectEvent = null;

// ==================== 文件缓存 ====================
function fileExists(path) {
    return Files.exists(Paths.get(path));
}

function writeStringToFile(path, text) {
    const p = Paths.get(path);
    const parent = p.getParent();
    if (parent) Files.createDirectories(parent);

    const writer = Files.newBufferedWriter(p, StandardCharsets.UTF_8);
    try {
        writer.write("" + text);   // 强制转成 JS 字符串，再由 GraalJS 自动转 Java String
    } finally {
        writer.close();
    }
}

function readStringFromFile(path) {
    const reader = Files.newBufferedReader(Paths.get(path), StandardCharsets.UTF_8);
    let result = "";
    try {
        let line;
        let first = true;
        while ((line = reader.readLine()) !== null) {
            if (!first) result += "\n";
            result += "" + line;
            first = false;
        }
    } finally {
        reader.close();
    }
    return result;
}

function deleteFileIfExists(path) {
    try {
        return Files.deleteIfExists(Paths.get(path));
    } catch (e) {
        return false;
    }
}

function saveBarrelTasks() {
    try {
        if (!barrelTasks || barrelTasks.length === 0) return;

        const data = {
            version: 1,
            savedAt: Date.now(),
            scanRange: SCAN_RANGE,
            barrels: barrelTasks
        };

        writeStringToFile(BARREL_CACHE_FILE, JSON.stringify(data, null, 2));
    } catch (e) {
        Chat.log("§c保存木桶缓存失败: " + e);
    }
}

function loadBarrelTasksFromFile() {
    if (!fileExists(BARREL_CACHE_FILE)) return null;

    try {
        const text = readStringFromFile(BARREL_CACHE_FILE);
        const data = JSON.parse(text);

        if (!data || !Array.isArray(data.barrels)) return null;

        const tasks = data.barrels
            .map((b, i) => ({
                index: typeof b.index === "number" ? b.index : i,
                x: b.x,
                y: b.y,
                z: b.z,
                state: b.state || BARREL_STATE_PENDING
            }))
            .filter(b =>
                Number.isFinite(b.x) &&
                Number.isFinite(b.y) &&
                Number.isFinite(b.z)
            );

        return tasks.length > 0 ? tasks : null;
    } catch (e) {
        Chat.log("§c读取木桶缓存失败: " + e);
        return null;
    }
}

function deleteBarrelCache() {
    try {
        if (deleteFileIfExists(BARREL_CACHE_FILE)) {
            Chat.log("§a已删除木桶缓存文件。");
        }
    } catch (e) {
        Chat.log("§c删除木桶缓存失败: " + e);
    }
}

function createBarrelTasksFromScan(barrels) {
    return barrels.map((pos, i) => ({
        index: i,
        x: pos.getX(),
        y: pos.getY(),
        z: pos.getZ(),
        state: BARREL_STATE_PENDING
    }));
}

// 意外退出 / 断开连接前尽量保存
try {
    shutdownEvent = JsMacros.on("ClientShutdown", JavaWrapper.methodToJava(() => {
        if (barrelTasks && barrelTasks.length > 0) saveBarrelTasks();
    }));
} catch (e) {}

try {
    disconnectEvent = JsMacros.on("Disconnect", JavaWrapper.methodToJava(() => {
        if (barrelTasks && barrelTasks.length > 0) saveBarrelTasks();
    }));
} catch (e) {}

// ==================== Baritone 寻路封装 ====================
function getBaritone() {
    return BaritoneAPI.getProvider().getPrimaryBaritone();
}

function getPlayerContext() {
    return getBaritone().getPlayerContext();
}

function goToBlock(x, y, z, timeoutTicks) {
    timeoutTicks = timeoutTicks || PATH_TIMEOUT_TICKS;
    const baritone = getBaritone();

    baritone.getCustomGoalProcess().setGoalAndPath(new GoalBlock(x, y, z));

    for (let i = 0; i < timeoutTicks; i++) {
        if (stopRequested) {
            getBaritone().getPathingBehavior().cancelEverything();
            return false;
        }
        Client.waitTick(5);
        if (!baritone.getCustomGoalProcess().isActive()) {
            return true;
        }
    }

    baritone.getPathingBehavior().cancelEverything();
    return false;
}

function goToNear(x, y, z, range, timeoutTicks) {
    range = range || 2;
    timeoutTicks = timeoutTicks || PATH_TIMEOUT_TICKS;
    const baritone = getBaritone();

    baritone.getCustomGoalProcess().setGoalAndPath(new GoalNear(new BlockPos(x, y, z), range));

    for (let i = 0; i < timeoutTicks; i++) {
        if (stopRequested) {
            getBaritone().getPathingBehavior().cancelEverything();
            return false;
        }
        Client.waitTick(5);
        if (!baritone.getCustomGoalProcess().isActive()) {
            return true;
        }
    }

    baritone.getPathingBehavior().cancelEverything();
    return false;
}

function stopBaritone() {
    getBaritone().getPathingBehavior().cancelEverything();
}

// ==================== 扫描木桶 ====================
function scanBarrels(range) {
    const provider = BaritoneAPI.getProvider();
    const scanner = provider.getWorldScanner();
    const ctx = getPlayerContext();

    const BlockOptionalMetaLookup = Java.type("baritone.api.utils.BlockOptionalMetaLookup");
    const filter = new BlockOptionalMetaLookup("minecraft:barrel");
    const javaList = scanner.scanChunkRadius(ctx, filter, -1, -1, range);

    const result = [];
    for (let i = 0; i < javaList.size(); i++) {
        result.push(javaList.get(i));
    }
    return result;
}

// ==================== 工具函数 ====================
function safeGetSlot(inv, slot) {
    if (!inv || slot < 0 || slot >= inv.getTotalSlots()) return null;
    return inv.getSlot(slot);
}

function isZoneEmpty(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (item && !item.isEmpty()) return false;
    }
    return true;
}

function getFirstNonEmptySlot(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (item && !item.isEmpty()) return slot;
    }
    return -1;
}

function getFirstEmptySlot(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) return slot;
    }
    return -1;
}

function isZoneFull(inv, slotList) {
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) return false;
    }
    return true;
}

function countEmptySlots(inv, slotList) {
    let count = 0;
    for (let slot of slotList) {
        let item = safeGetSlot(inv, slot);
        if (!item || item.isEmpty()) count++;
    }
    return count;
}

function isPlayerInventoryOnly(inv, expectedTotalSlots) {
    if (!inv) return true;
    return inv.getTotalSlots() === 46;
}

function waitForContainerOpen(expectedTotalSlots, timeoutTicks) {
    timeoutTicks = timeoutTicks || 20;
    for (let i = 0; i < timeoutTicks; i++) {
        const inv = Player.openInventory();
        if (inv && inv.getTotalSlots() >= expectedTotalSlots) {
            return inv;
        }
        Client.waitTick(1);
    }
    return null;
}

// ==================== 位置记录与恢复 ====================
function savePlayerState() {
    const player = Player.getPlayer();
    const pos = player.getPos();
    savedLocation = {
        x: pos.x, y: pos.y, z: pos.z,
        yaw: player.getYaw(),
        pitch: player.getPitch()
    };
}

function restorePlayerState() {
    if (!savedLocation) return;

    goToNear(
        Math.floor(savedLocation.x),
        Math.floor(savedLocation.y),
        Math.floor(savedLocation.z),
        2
    );

    const player = Player.getPlayer();
    player.lookAt(savedLocation.x, savedLocation.y + player.getEyeHeight(), savedLocation.z);
    Client.waitTick(2);
    savedLocation = null;
}

// ==================== 移动与交互 ====================
function moveToBlock(blockX, blockY, blockZ) {
    return goToNear(blockX, blockY, blockZ, 2);
}

function getLookedAtBlock(maxDistance) {
    maxDistance = maxDistance || 6;
    const player = Player.getPlayer();
    const hit = player.rayTraceBlock(maxDistance, false);
    if (!hit) return null;
    return hit.getBlockPos();
}

function isSameBlockPos(pos, x, y, z) {
    if (!pos) return false;
    return pos.getX() === x && pos.getY() === y && pos.getZ() === z;
}

function randomMove() {
    const player = Player.getPlayer();
    const pos = player.getPos();
    const dx = (Math.random() - 0.5) * 4;
    const dz = (Math.random() - 0.5) * 4;
    const targetX = Math.floor(pos.x + dx);
    const targetZ = Math.floor(pos.z + dz);
    const targetY = Math.floor(pos.y);

    goToNear(targetX, targetY, targetZ, 1, 60);
}

// ==================== 打开容器 ====================
// 只负责：寻路到目标附近 + 对准，直到射线命中目标方块
// 射线未命中时：随机走 + 重新寻路
// 返回值：true = 射线已确认目标；false = 被强制停止
// 只负责：寻路到目标附近 + 对准，直到射线命中目标方块
// 策略：
//   - 常规：goToNear(target, 3) 靠近目标
//   - 每次未命中：randomMove + 立即 lookAt + rayTrace
//   - 每 15 次随机移动后：goToNear(target, 1) 强制拉近一次，避免越走越远
// 返回值：true = 射线已确认目标；false = 被强制停止
function ensureRayOnTarget(blockX, blockY, blockZ, maxRayAttempts) {
    maxRayAttempts = maxRayAttempts || 0; // 0 = 无限
    let attempts = 0;
    let randomMoveCount = 0;              // 随机移动计数器
    const CLOSE_EVERY = 15;               // 每 15 次随机移动强制拉近一次

    while (!stopRequested) {
        attempts++;
        if (maxRayAttempts > 0 && attempts > maxRayAttempts) {
            return false;
        }

        // 寻路到目标附近（初次 / 拉近后回到这里）
        if (!goToNear(blockX, blockY, blockZ, 3)) {
            if (stopRequested) return false;
            randomMove();
            randomMoveCount++;
            if (randomMoveCount >= CLOSE_EVERY) {
                randomMoveCount = 0;
                goToNear(blockX, blockY, blockZ, 1);
            }
            continue;
        }
        Client.waitTick(3);

        // 对准目标
        const player = Player.getPlayer();
        player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
        Client.waitTick(3);

        // 射线检测
        const looked = getLookedAtBlock(6);
        if (isSameBlockPos(looked, blockX, blockY, blockZ)) {
            return true;
        }

        // 未命中：随机走
        if (stopRequested) return false;
        randomMove();
        randomMoveCount++;
        Client.waitTick(3);

        // 随机移动后立即对准并再次射线检测，命中直接返回
        player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
        Client.waitTick(2);

        const lookedAfterMove = getLookedAtBlock(6);
        if (isSameBlockPos(lookedAfterMove, blockX, blockY, blockZ)) {
            return true;
        }

        // 每 15 次随机移动，强制拉近一次
        if (randomMoveCount >= CLOSE_EVERY) {
            randomMoveCount = 0;
            if (stopRequested) return false;

            //Chat.log(`§7已随机移动 ${CLOSE_EVERY} 次未命中，强制拉近目标 (${blockX}, ${blockY}, ${blockZ})`);
            goToNear(blockX, blockY, blockZ, 1);
            Client.waitTick(3);

            // 拉近后立即再次射线检测，命中直接返回
            player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
            Client.waitTick(2);

            const lookedAfterClose = getLookedAtBlock(6);
            if (isSameBlockPos(lookedAfterClose, blockX, blockY, blockZ)) {
                return true;
            }
        }
    }

    return false;
}

// 返回值：
//   Inventory -> 成功打开目标容器
//   null      -> 暂时失败
//   "DONE"    -> 交互无反应，仅打开玩家栏（仅 allowDoneDetection=true 时）
function openBlockInventory(blockX, blockY, blockZ, maxRetries, allowDoneDetection, expectedTotalSlots) {
    maxRetries = maxRetries || 5;
    allowDoneDetection = allowDoneDetection === true;
    expectedTotalSlots = expectedTotalSlots || BARREL_TOTAL_SLOTS;
    let playerInventoryOnlyCount = 0;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        if (stopRequested) return null;

        if (!ensureRayOnTarget(blockX, blockY, blockZ, 0)) {
            return null; // 确认射线
        }

        const player = Player.getPlayer();
        player.interact();
        const inv = waitForContainerOpen(expectedTotalSlots, 20);

        if (!inv || isPlayerInventoryOnly(inv, expectedTotalSlots)) {
            if (stopRequested) return null;

            const lookedNow = getLookedAtBlock(6);
            if (!isSameBlockPos(lookedNow, blockX, blockY, blockZ)) {
                if (inv) inv.close();
                Client.waitTick(2);
                randomMove();
                player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
                continue;
            }

            // 射线检测目标正确：不再随机走，只重新对准并重试
            if (!allowDoneDetection) {
                if (inv) inv.close();
                Client.waitTick(2);
                player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
                Client.waitTick(3);
                continue;
            }

            playerInventoryOnlyCount++;

            if (inv) inv.close();
            Client.waitTick(2);

            if (playerInventoryOnlyCount >= 2) {
                return "DONE";
            }

            player.lookAt(blockX + 0.5, blockY + 0.5, blockZ + 0.5);
            Client.waitTick(3);
            continue;
        }

        const lookedAfter = getLookedAtBlock(6);
        if (!isSameBlockPos(lookedAfter, blockX, blockY, blockZ)) {
            if (stopRequested) return null;
            inv.close();
            Client.waitTick(2);
            randomMove();
            continue;
        }

        return inv;
    }

    return null;
}

// 补货专用：未打开就随机走 + 重新寻路，直到打开或强制退出
function openBlockInventoryForRestock(blockX, blockY, blockZ, expectedTotalSlots) {
    expectedTotalSlots = expectedTotalSlots || RESTOCK_TOTAL_SLOTS;
    let attempts = 0;

    while (!stopRequested) {
        attempts++;

        const inv = openBlockInventory(blockX, blockY, blockZ, 1, false, expectedTotalSlots);
        if (inv && inv !== "DONE") {
            return inv;
        }

        abortIfStopped();
        Chat.log(`§e补货容器未打开，随机移动后重新寻路重试（第 ${attempts} 次）...`);
        randomMove();
        Client.waitTick(3);
    }

    return null;
}

// ==================== 补货逻辑 ====================
function putIronBucketsIntoChest() {
    abortIfStopped();

    const cx = IRON_BUCKET_CHEST.x;
    const cy = IRON_BUCKET_CHEST.y;
    const cz = IRON_BUCKET_CHEST.z;

    const invCheck = Player.openInventory();
    const playerWindowSlots = playerSlotsToWindowSlots_27(IRON_BUCKET_SLOTS);
    let hasBucket = false;

    for (let ws of playerWindowSlots) {
        const item = safeGetSlot(invCheck, ws);
        if (item && !item.isEmpty()) {
            hasBucket = true;
            break;
        }
    }

    invCheck.close();
    Client.waitTick(2);
    
    /*
    if (!hasBucket) {
        return true;
    }*/

    if (!moveToBlock(cx, cy, cz)) {
        abortIfStopped();
        Chat.log(`§c无法到达铁桶容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }
    Client.waitTick(3);

    const inv = openBlockInventoryForRestock(cx, cy, cz, RESTOCK_TOTAL_SLOTS);
    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开铁桶容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }

    let movedAny = false;

    for (let windowSlot of playerWindowSlots) {
        abortIfStopped();

        const item = safeGetSlot(inv, windowSlot);
        if (!item || item.isEmpty()) continue;

        let targetSlot = -1;
        for (let c = 0; c < RESTOCK_CONTAINER_SIZE; c++) {
            const cItem = safeGetSlot(inv, c);
            if (!cItem || cItem.isEmpty()) {
                targetSlot = c;
                break;
            }
        }

        if (targetSlot === -1) {
            Chat.log("§e铁桶容器已满，停止放入。");
            break;
        }

        inv.quick(windowSlot);
        Client.waitTick(3);
        movedAny = true;
    }

    inv.close();
    Client.waitTick(2);

    return true;
}

// 对指定区补货（27 格小箱子）
// 注意：此函数只负责补货，不再负责放铁桶
function restockZone(zoneId) {
    abortIfStopped();

    const chestPos = RESTOCK_CHESTS[zoneId];
    if (!chestPos) {
        Chat.log(`§c区 ${zoneId} 没有配置补货容器坐标。`);
        return false;
    }

    const cx = chestPos.x, cy = chestPos.y, cz = chestPos.z;

    if (!moveToBlock(cx, cy, cz)) {
        abortIfStopped();
        Chat.log(`§c无法到达区 ${zoneId} 的补货容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }
    Client.waitTick(3);

    const inv = openBlockInventoryForRestock(cx, cy, cz, RESTOCK_TOTAL_SLOTS);
    Client.waitTick(3);

    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开区 ${zoneId} 的补货容器 (${cx}, ${cy}, ${cz})`);
        return false;
    }

    const playerSlotList = ZONE_SLOTS[zoneId];
    const windowSlotList = playerSlotsToWindowSlots_27(playerSlotList);

    let movedAny = false;

    for (let containerSlot = 0; containerSlot < RESTOCK_CONTAINER_SIZE; containerSlot++) {
        abortIfStopped();

        if (isZoneFull(inv, windowSlotList)) break;

        const item = safeGetSlot(inv, containerSlot);
        if (item && !item.isEmpty()) {
            const targetWindowSlot = getFirstEmptySlot(inv, windowSlotList);
            if (targetWindowSlot === -1) break;

            inv.click(containerSlot, 0);
            Client.waitTick(3);
            inv.click(targetWindowSlot, 0);
            Client.waitTick(3);
            movedAny = true;
        }
    }

    const full = isZoneFull(inv, windowSlotList);
    const emptyCount = countEmptySlots(inv, windowSlotList);

    inv.close();
    Client.waitTick(2);

    if (!movedAny) {
        Chat.log(`§c区 ${zoneId} 的补货容器里没有可用物品。`);
        return false;
    }

    if (!full) {
        Chat.log(`§e区 ${zoneId} 未补满，还缺 ${emptyCount} 个槽位。`);
    }

    // 不再在这里放铁桶，改由 restockAllEmptyZones 统一处理
    return full;
}

// 1、2 区绑定补货；只有本次包含 1、2 区时，补完后统一放一次铁桶
function restockAllEmptyZones(emptyZones) {
    // 1、2 区绑定：只要有一个为空，两个都补
    const zonesToRestock = [...emptyZones];
    const need12 = emptyZones.includes(1) || emptyZones.includes(2);

    if (need12) {
        if (!zonesToRestock.includes(1)) zonesToRestock.push(1);
        if (!zonesToRestock.includes(2)) zonesToRestock.push(2);
    }

    // 排序，让补货顺序自然一点：1、2、3、4、5
    zonesToRestock.sort((a, b) => a - b);

    let allSuccess = true;
    for (let zoneId of zonesToRestock) {
        abortIfStopped();
        if (!restockZone(zoneId)) {
            allSuccess = false;
        }
        Client.waitTick(3);
    }

    // 只有这次补货包含 1、2 区时，才放一次铁桶
    if (need12) {
        abortIfStopped();
        putIronBucketsIntoChest();
    }

    return allSuccess;
}

// ==================== 核心工作逻辑 ====================
// 返回值：
//   true     -> 正常完成
//   "DONE"   -> 木桶已完成（交互无反应）
//   false    -> 暂时失败，可重试
function processBarrel(task) {
    abortIfStopped();

    const bx = task.x;
    const by = task.y;
    const bz = task.z;

    if (!moveToBlock(bx, by, bz)) {
        abortIfStopped();
        Chat.log(`§c无法到达木桶 (${bx}, ${by}, ${bz})`);
        return false;
    }
    Client.waitTick(5);

    let inv = openBlockInventory(bx, by, bz, 5, true, BARREL_TOTAL_SLOTS);

    if (inv === "DONE") {
        return "DONE";
    }

    if (!inv) {
        abortIfStopped();
        Chat.log(`§c无法打开木桶 (${bx}, ${by}, ${bz})`);
        return false;
    }

    let emptyZones = [];
    for (let zoneId in ZONE_SLOTS) {
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        if (isZoneEmpty(inv, windowSlots)) {
            emptyZones.push(parseInt(zoneId));
        }
    }

    if (emptyZones.length > 0) {
        inv.close();
        Client.waitTick(2);

        savePlayerState();
        const restockOk = restockAllEmptyZones(emptyZones);
        abortIfStopped();
        restorePlayerState();
        Client.waitTick(3);

        inv = openBlockInventory(bx, by, bz, 5, true, BARREL_TOTAL_SLOTS);

        if (inv === "DONE") {
            return "DONE";
        }

        if (!inv) {
            abortIfStopped();
            Chat.log(`§c补货后无法重新打开木桶 (${bx}, ${by}, ${bz})`);
            return false;
        }

        let stillEmpty = [];
        for (let zoneId in ZONE_SLOTS) {
            const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
            if (isZoneEmpty(inv, windowSlots)) {
                stillEmpty.push(parseInt(zoneId));
            }
        }

        if (stillEmpty.length > 0) {
            inv.close();
            Client.waitTick(2);
            return false;
        }
    }

    // 装填木桶：1、2 区整组移动
    for (let zoneId of [1, 2]) {
        abortIfStopped();
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        let srcSlot = getFirstNonEmptySlot(inv, windowSlots);
        if (srcSlot !== -1) {
            const dstSlot = ZONE_TARGET_SLOTS[zoneId];
            inv.click(srcSlot, 0);
            Client.waitTick(3);
            inv.click(dstSlot, 0);
            Client.waitTick(3);
        }
    }

    // 装填木桶：3、4、5 区单个移动
    for (let zoneId of [3, 4, 5]) {
        abortIfStopped();
        const windowSlots = playerSlotsToWindowSlots_54(ZONE_SLOTS[zoneId]);
        let srcSlot = getFirstNonEmptySlot(inv, windowSlots);
        if (srcSlot !== -1) {
            const dstSlot = ZONE_TARGET_SLOTS[zoneId];
            inv.click(srcSlot, 0);
            Client.waitTick(3);
            inv.click(dstSlot, 1);
            Client.waitTick(3);
            inv.click(srcSlot, 0);
            Client.waitTick(3);
        }
    }

    inv.click(FINAL_CLICK_SLOT);
    Client.waitTick(2);

    inv.close();
    Client.waitTick(2);
    return true;
}

// ==================== 主流程 ====================
function main() {
    try {
        configureBaritone();

        const loaded = loadBarrelTasksFromFile();

        if (loaded && loaded.length > 0) {
            barrelTasks = loaded;
            Chat.log(`§a从缓存文件读取 ${barrelTasks.length} 个木桶任务，跳过扫描。`);
        } else {
            Chat.log(`§e正在扫描周围 ${SCAN_RANGE} 区块内的木桶...`);

            allBarrels = scanBarrels(SCAN_RANGE);

            if (allBarrels.length === 0) {
                Chat.log("§c附近没有找到任何木桶。");
                return;
            }

            barrelTasks = createBarrelTasksFromScan(allBarrels);
            saveBarrelTasks();

            Chat.log(`§a找到 ${barrelTasks.length} 个木桶，已写入缓存，开始处理。`);
        }

        pendingBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_PENDING);
        completedBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_COMPLETED);
        doneBarrels = barrelTasks.filter(t => t.state === BARREL_STATE_DONE);

        let failCount = 0;

        while (pendingBarrels.length > 0) {
            abortIfStopped();

            savePlayerState();

            const task = pendingBarrels[0];
            const bx = task.x, by = task.y, bz = task.z;

            const result = processBarrel(task);

            abortIfStopped();

            if (result === "DONE") {
                task.state = BARREL_STATE_DONE;
                completedBarrels.push(pendingBarrels.shift());
                doneBarrels.push(task);
                failCount = 0;
            } else if (result === true) {
                task.state = BARREL_STATE_COMPLETED;
                completedBarrels.push(pendingBarrels.shift());
                failCount = 0;
            } else {
                pendingBarrels.push(pendingBarrels.shift());
                failCount++;

                if (failCount >= pendingBarrels.length) {
                    Chat.log("§c所有木桶都无法处理，退出。");
                    saveBarrelTasks();
                    break;
                }
            }

            saveBarrelTasks();
            Client.waitTick(5);
        }

        const hasPending = barrelTasks.some(t => t.state === BARREL_STATE_PENDING);

        if (!hasPending) {
            deleteBarrelCache();
            Chat.log(`§a所有任务完成，共处理 ${barrelTasks.length} 个木桶。`);
        } else {
            saveBarrelTasks();
            Chat.log("§e仍有未完成木桶，缓存已保存。");
        }

    } catch (e) {
        if (e && e.message === "STOP_REQUESTED") {
            Chat.log("§c已中断，退出主流程。");
        } else {
            Chat.log("§c主流程异常: " + e);
        }

        saveBarrelTasks();

    } finally {
        stopBaritone();

        if (barrelTasks && barrelTasks.some(t => t.state === BARREL_STATE_PENDING)) {
            saveBarrelTasks();
        }

        const finished = barrelTasks.filter(t => t.state !== BARREL_STATE_PENDING).length;
        const doneCount = barrelTasks.filter(t => t.state === BARREL_STATE_DONE).length;

        Chat.log(`§a流程结束，共处理 ${finished} 个木桶（其中 ${doneCount} 个判定为已完成）。`);
    }
}

// 启动
main();
