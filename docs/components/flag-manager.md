# Flag Manager Component

Global boolean flag system for tracking game state and progression.

---

## Overview

**Flag Manager** provides a simple, efficient system for managing boolean flags (game state markers). It's designed for:
- Quest completion tracking
- World state management
- Player progression flags
- Achievement/unlock systems
- Feature toggles

Flags are identified by string keys and stored in a Set for O(1) operations.

**Uniqueness:** GLOBAL - Only one flag-manager allowed per scene hierarchy.

---

## Interface

```typescript
interface FlagManagerT extends ComponentData {
    type: 'flag-manager';
    unique: ComponentUnique.GLOBAL;  // Only one per scene
    flags: Set<string>;
}
```

---

## Usage

### Basic Creation

```typescript
import { newComponent } from 'omosuen';

const flagManager = await newComponent('flag-manager', { name: 'Game Flags' });
```

### Adding Flags

```typescript
import { FlagManager } from 'omosuen';

// Add single flag
FlagManager.addFlag(flagManager, 'tutorialComplete');

// Add multiple flags
FlagManager.addFlags(flagManager, [
    'level1Complete',
    'level2Complete',
    'bossDefeated'
]);
```

### Checking Flags

```typescript
// Check single flag
if (FlagManager.hasFlag(flagManager, 'tutorialComplete')) {
    console.log('Player completed tutorial');
}

// Check if ALL flags exist
if (FlagManager.hasAllFlags(flagManager, ['level1Complete', 'level2Complete'])) {
    console.log('Levels 1 and 2 complete!');
}

// Check if ANY flag exists
if (FlagManager.hasAnyFlag(flagManager, ['speedBoost', 'shield', 'doubleJump'])) {
    console.log('Player has at least one power-up');
}

// Check if NONE of the flags exist
if (FlagManager.hasNoneOfFlags(flagManager, ['gameOver', 'playerDied'])) {
    console.log('Game is still active');
}
```

### Removing Flags

```typescript
// Remove single flag
FlagManager.removeFlag(flagManager, 'tempBoost');

// Remove multiple flags
FlagManager.removeFlags(flagManager, ['tempBoost', 'invincible']);

// Remove all flags
FlagManager.clearFlags(flagManager);
```

### Getting All Flags

```typescript
const allFlags = FlagManager.getFlags(flagManager);
console.log('Active flags:', allFlags);
// ['tutorialComplete', 'level1Complete', 'bossDefeated']
```

---

## Methods

### hasFlag(flag)

Check if a specific flag exists.

```typescript
FlagManager.hasFlag(flagManager: FlagManagerT, flag: string): boolean
```

**Parameters:**
- `flag` - The flag to check for

**Returns:** `true` if flag exists, `false` otherwise

**Example:**

```typescript
if (FlagManager.hasFlag(flagManager, 'hasDoubleJump')) {
    player.enableDoubleJump();
}
```

### hasAllFlags(flags)

Check if ALL specified flags exist.

```typescript
FlagManager.hasAllFlags(
    flagManager: FlagManagerT,
    flags: string | string[]
): boolean
```

**Parameters:**
- `flags` - Single flag string or array of flags

**Returns:** `true` if all flags exist, `false` if any are missing

**Example:**

```typescript
// Single flag
if (FlagManager.hasAllFlags(flagManager, 'step1')) {
    // ...
}

// Multiple flags (AND logic)
if (FlagManager.hasAllFlags(flagManager, ['step1', 'step2', 'step3'])) {
    console.log('Tutorial fully complete!');
    unlockNextLevel();
}
```

### hasAnyFlag(flags)

Check if ANY of the specified flags exist.

```typescript
FlagManager.hasAnyFlag(
    flagManager: FlagManagerT,
    flags: string | string[]
): boolean
```

**Parameters:**
- `flags` - Single flag string or array of flags

**Returns:** `true` if at least one flag exists, `false` if none exist

**Example:**

```typescript
// Single flag
if (FlagManager.hasAnyFlag(flagManager, 'speedBoost')) {
    // ...
}

// Multiple flags (OR logic)
if (FlagManager.hasAnyFlag(flagManager, ['key1', 'key2', 'masterKey'])) {
    console.log('Player can unlock door');
    door.unlock();
}
```

### hasNoneOfFlags(flags)

Check if NONE of the specified flags exist.

```typescript
FlagManager.hasNoneOfFlags(
    flagManager: FlagManagerT,
    flags: string | string[]
): boolean
```

**Parameters:**
- `flags` - Single flag string or array of flags

**Returns:** `true` if none exist, `false` if any exist

**Example:**

```typescript
// Single flag
if (FlagManager.hasNoneOfFlags(flagManager, 'gameOver')) {
    // Game is still running
}

// Multiple flags
if (FlagManager.hasNoneOfFlags(flagManager, ['died', 'gameOver', 'quit'])) {
    console.log('Game is active');
    continueGameLoop();
}
```

### addFlag(flag)

Add a single flag.

```typescript
FlagManager.addFlag(flagManager: FlagManagerT, flag: string): void
```

**Parameters:**
- `flag` - The flag to add

**Example:**

```typescript
FlagManager.addFlag(flagManager, 'bossDefeated');
FlagManager.addFlag(flagManager, 'secretFound');
```

**Note:** If flag already exists, this is a no-op (Sets don't have duplicates).

### addFlags(flags)

Add multiple flags at once.

```typescript
FlagManager.addFlags(flagManager: FlagManagerT, flags: string[]): void
```

**Parameters:**
- `flags` - Array of flags to add

**Example:**

```typescript
FlagManager.addFlags(flagManager, [
    'level1Complete',
    'level2Complete',
    'level3Complete'
]);

// Unlock power-ups
FlagManager.addFlags(flagManager, [
    'hasDoubleJump',
    'hasWallJump',
    'hasDash'
]);
```

### removeFlag(flag)

Remove a single flag.

```typescript
FlagManager.removeFlag(flagManager: FlagManagerT, flag: string): void
```

**Parameters:**
- `flag` - The flag to remove

**Example:**

```typescript
// Remove temporary power-up
FlagManager.removeFlag(flagManager, 'tempInvincible');
```

**Note:** If flag doesn't exist, this is a no-op.

### removeFlags(flags)

Remove multiple flags at once.

```typescript
FlagManager.removeFlags(flagManager: FlagManagerT, flags: string[]): void
```

**Parameters:**
- `flags` - Array of flags to remove

**Example:**

```typescript
// Remove all power-ups
FlagManager.removeFlags(flagManager, [
    'speedBoost',
    'shield',
    'doubleJump'
]);
```

### getFlags()

Get all flags as an array.

```typescript
FlagManager.getFlags(flagManager: FlagManagerT): string[]
```

**Returns:** Array of all flag strings (new array, safe to modify)

**Example:**

```typescript
const allFlags = FlagManager.getFlags(flagManager);
console.log('Active flags:', allFlags);

// Save to file
saveData.flags = allFlags;
```

### clearFlags()

Remove all flags.

```typescript
FlagManager.clearFlags(flagManager: FlagManagerT): void
```

**Example:**

```typescript
// Reset for new game
FlagManager.clearFlags(flagManager);
```

---

## Properties

### flags

Direct access to the internal Set.

```typescript
flagManager.flags: Set<string>
```

**Example:**

```typescript
console.log(`${flagManager.flags.size} flags active`);

flagManager.flags.forEach(flag => {
    console.log(` - ${flag}`);
});
```

**Warning:** Modifying this directly bypasses method logic. Use methods instead for consistency.

---

## Common Patterns

### Quest Completion

```typescript
// Start quest
FlagManager.addFlag(flagManager, 'quest_1_started');

// Complete objectives
FlagManager.addFlag(flagManager, 'quest_1_obj_1');
FlagManager.addFlag(flagManager, 'quest_1_obj_2');
FlagManager.addFlag(flagManager, 'quest_1_obj_3');

// Check completion
if (FlagManager.hasAllFlags(flagManager, [
    'quest_1_obj_1',
    'quest_1_obj_2',
    'quest_1_obj_3'
])) {
    FlagManager.addFlag(flagManager, 'quest_1_complete');
    giveReward();
}
```

### Progressive Unlocks

```typescript
// Check prerequisites
if (FlagManager.hasAllFlags(flagManager, ['level1', 'level2', 'level3'])) {
    FlagManager.addFlag(flagManager, 'hardModeUnlocked');
    showHardModeOption();
}

// Secret unlock
if (FlagManager.hasAllFlags(flagManager, [
    'allLevelsComplete',
    'allSecretsFound',
    'noDeaths'
])) {
    FlagManager.addFlag(flagManager, 'truendingUnlocked');
}
```

### Ability System

```typescript
// Unlock abilities
function unlockAbility(ability) {
    FlagManager.addFlag(flagManager, `has_${ability}`);
}

unlockAbility('doubleJump');
unlockAbility('wallJump');
unlockAbility('dash');

// Check if player has ability
function hasAbility(ability) {
    return FlagManager.hasFlag(flagManager, `has_${ability}`);
}

if (hasAbility('doubleJump')) {
    player.enableDoubleJump();
}
```

### Temporary Buffs

```typescript
// Grant temporary buff
FlagManager.addFlag(flagManager, 'buff_invincible');

setTimeout(() => {
    FlagManager.removeFlag(flagManager, 'buff_invincible');
    console.log('Invincibility expired');
}, 10000);

// Check in update loop
if (FlagManager.hasFlag(flagManager, 'buff_invincible')) {
    // Player is invincible
    return;  // Skip damage
}
```

### Save/Load System

```typescript
// Save flags to localStorage
function saveGame() {
    const flags = FlagManager.getFlags(flagManager);
    localStorage.setItem('gameFlags', JSON.stringify(flags));
}

// Load flags from localStorage
function loadGame() {
    const saved = localStorage.getItem('gameFlags');
    if (saved) {
        const flags = JSON.parse(saved);
        FlagManager.clearFlags(flagManager);
        FlagManager.addFlags(flagManager, flags);
    }
}
```

### Debug Commands

```typescript
// Debug: unlock all levels
function unlockAllLevels() {
    FlagManager.addFlags(flagManager, [
        'level1', 'level2', 'level3', 'level4', 'level5',
        'level6', 'level7', 'level8', 'level9', 'level10'
    ]);
}

// Debug: print all flags
function debugFlags() {
    const flags = FlagManager.getFlags(flagManager);
    console.log('Active Flags:');
    flags.forEach(flag => console.log(` - ${flag}`));
}
```

---

## Flag Naming Conventions

### Recommended Patterns

```typescript
// Quest flags
'quest_<id>_started'
'quest_<id>_obj_<n>'
'quest_<id>_complete'

// Level progression
'level_<n>_unlocked'
'level_<n>_complete'
'level_<n>_perfect'  // No damage, all secrets, etc.

// Abilities/Power-ups
'has_<ability>'
'can_<action>'

// World state
'boss_<name>_defeated'
'secret_<id>_found'
'npc_<name>_met'

// Temporary states
'buff_<type>'
'debuff_<type>'
'temp_<state>'

// Achievements
'achievement_<id>'
'unlocked_<feature>'
```

### Examples

```typescript
// Good naming
FlagManager.addFlag(flagManager, 'quest_main_1_obj_2');
FlagManager.addFlag(flagManager, 'has_double_jump');
FlagManager.addFlag(flagManager, 'boss_dragon_defeated');

// Avoid vague names
FlagManager.addFlag(flagManager, 'flag1');  // What is this?
FlagManager.addFlag(flagManager, 'done');   // Done with what?
```

---

## Serialization

Flag Manager serializes all flags:

```json
{
    "type": "flag-manager",
    "name": "Game Flags",
    "flags": [
        "tutorialComplete",
        "level1Complete",
        "hasDoubleJump",
        "bossDefeated"
    ]
}
```

Flags are automatically restored on deserialization.

---

## Best Practices

### 1. Use Namespaced Flags

```typescript
// GOOD - Clear namespace
'quest_main_1_complete'
'ability_double_jump'
'world_boss_defeated'

// AVOID - Ambiguous
'complete'
'jump'
'boss'
```

### 2. Document Flag Meanings

```typescript
// Document complex flag logic
/*
 * Progression Flags:
 * - level_<n>_unlocked: Player can access level n
 * - level_<n>_complete: Player finished level n
 * - level_<n>_perfect: Player got 100% in level n
 */
```

### 3. Use Global Flag Manager

```typescript
// Access from anywhere in scene
const scene = getActiveScene();
const flags = scene.getComponentByType('flag-manager', true);

if (flags && FlagManager.hasFlag(flags, 'tutorialComplete')) {
    // Skip tutorial
}
```

### 4. Clear Flags Between Games

```typescript
// New game
function startNewGame() {
    FlagManager.clearFlags(flagManager);

    // Set initial flags
    FlagManager.addFlags(flagManager, [
        'newGame',
        'level_1_unlocked'
    ]);
}
```

---

## Performance Notes

- Set-based storage: O(1) add, remove, has operations
- No duplicates (automatic deduplication)
- Memory efficient for large numbers of flags
- Safe to check non-existent flags (returns false, doesn't error)

---

## Next Steps

- Learn about [Data Layer](data-layer.md) for typed key-value storage
- Explore [Messenger](messenger.md) for event-based communication
- See [Scenes](../scenes.md) for serializing flags with scenes

---

**Source:** [src/component/flag-manager](../../src/component/flag-manager/)
