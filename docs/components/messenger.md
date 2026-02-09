# Messenger Component

Global message queue system for inter-component communication and event handling.

---

## Overview

**Messenger** provides a powerful messaging system for component communication. Key features:
- Send targeted messages to specific components
- Broadcast messages to all listeners
- Pattern matching (string, RegExp, symbols)
- Receiver filtering (by name, type, ID)
- Off-scene support (can function outside activeScene)
- Global message queue with batched processing

**Note:** The messenger system is currently in development. Core send/receive functionality is implemented, but message processing integration is not yet complete.

---

## Interface

```typescript
interface MessengerT extends ComponentData {
    type: 'messenger';
    unique: ComponentUnique.FALSE;  // Multiple instances allowed
    listeners: ListenerConfig[];    // Listener configurations
}

interface ListenerConfig {
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES;
    callbackKey: string;
}

interface MessageEnvelope {
    message: string;           // Message identifier
    sender: ComponentData;     // Sender messenger
    receiver: ComponentData;   // Matched receiver
    messenger: ComponentData;  // Handler messenger
    body: MessageBody;         // Payload data
    receiverOptions?: MessageReceiverOptions;
}

type MessageBody = Record<string, unknown>;
```

---

## Usage

### Basic Setup

```typescript
import { newComponent, registerMethod, ALL_MESSAGES } from 'omosuen';

// 1. Register message callback
registerMethod('message-listener', 'handleAttack', (envelope) => {
    console.log(`${envelope.receiver.name} received attack!`);
    console.log('Damage:', envelope.body.damage);
});

// 2. Create messenger with listeners
const messenger = await newComponent('messenger', {
    name: 'Player Messenger',
    listeners: [
        { pattern: 'attack', callbackKey: 'handleAttack' },
        { pattern: /damage:.*/, callbackKey: 'handleDamage' }
    ]
});

// 3. Send messages
messenger.send('attack', {
    mode: 'match-any',
    names: ['Enemy']
}, { damage: 10 });
```

---

## Methods

### send(message, receiverOptions, body?)

Send a message to specific receivers matching filter options.

```typescript
messenger.send(
    message: string,
    receiverOptions: MessageReceiverOptions | null,
    body?: MessageBody
): void
```

**Parameters:**
- `message` - Message identifier (e.g., "attack", "dialogue:start")
- `receiverOptions` - Filter options (or null for broadcast)
- `body` - Optional message payload

**Receiver Options:**

```typescript
interface MessageReceiverOptions {
    mode: 'match-any' | 'match-all' | 'broadcast';
    names?: string[];        // Match component names
    types?: COMPONENT_TYPE[]; // Match component types
    ids?: number[];          // Match component IDs (ignored in match-all mode)
}
```

**Examples:**

```typescript
// Send to components named "Enemy"
messenger.send('attack', {
    mode: 'match-any',
    names: ['Enemy']
}, { damage: 10 });

// Send to data-layer named "Event Log"
messenger.send('event', {
    mode: 'match-all',
    names: ['Event Log'],
    types: ['data-layer']
}, { message: 'Player won' });

// Send by ID
messenger.send('target', {
    mode: 'match-any',
    ids: [42, 43, 44]
}, { action: 'move' });

// Broadcast via null
messenger.send('gameStart', null, { level: 1 });
```

**Matching Modes:**

- **match-any**: Match if ANY filter criteria passes (OR logic)
  ```typescript
  // Matches if name is "Player" OR type is "enemy" OR id is 5
  { mode: 'match-any', names: ['Player'], types: ['enemy'], ids: [5] }
  ```

- **match-all**: Match if ALL filter criteria pass (AND logic, ignores ids)
  ```typescript
  // Matches if name is "Health" AND type is "data-layer"
  { mode: 'match-all', names: ['Health'], types: ['data-layer'] }
  ```

- **broadcast**: Send to all (ignores all filters)
  ```typescript
  { mode: 'broadcast' }
  ```

### broadcast(message, body?)

Broadcast a message to all messengers.

```typescript
messenger.broadcast(
    message: string,
    body?: MessageBody
): void
```

**Parameters:**
- `message` - Message identifier
- `body` - Optional message payload

**Example:**

```typescript
// Broadcast game state change
messenger.broadcast('gameStart', { level: 1 });

// Broadcast without payload
messenger.broadcast('playerDied');
```

**Equivalent to:**

```typescript
messenger.send('gameStart', { mode: 'broadcast' }, { level: 1 });
// or
messenger.send('gameStart', null, { level: 1 });
```

### on(pattern, callbackKey)

Register a message listener.

```typescript
messenger.on(
    pattern: string | RegExp | typeof ALL_MESSAGES | typeof ANY_MESSAGES,
    callbackKey: string
): ListenerHandle
```

**Parameters:**
- `pattern` - Message pattern to match
- `callbackKey` - Callback key in `MethodRegistry['message-listener']`

**Returns:** ListenerHandle for removal

**Pattern Types:**

```typescript
// String (exact match)
messenger.on('attack', 'handleAttack');

// RegExp (pattern match)
messenger.on(/damage:.*/, 'handleDamage');

// ALL_MESSAGES (receive every message)
import { ALL_MESSAGES } from 'omosuen';
messenger.on(ALL_MESSAGES, 'logAllMessages');

// ANY_MESSAGES (receive messages matching filters)
import { ANY_MESSAGES } from 'omosuen';
messenger.on(ANY_MESSAGES, 'handleFiltered');
```

**Example:**

```typescript
import { registerMethod } from 'omosuen';

// Register callback
registerMethod('message-listener', 'handleAttack', (envelope) => {
    const damage = envelope.body.damage ?? 0;
    console.log(`${envelope.receiver.name} took ${damage} damage`);
});

// Register listener
const handle = messenger.on('attack', 'handleAttack');

// Later: remove listener
messenger.removeListener(handle);
```

### removeListener(handle)

Remove a registered listener.

```typescript
messenger.removeListener(handle: ListenerHandle): void
```

**Parameters:**
- `handle` - Handle returned by `on()`

**Example:**

```typescript
const handle = messenger.on('attack', 'handleAttack');

// Later...
messenger.removeListener(handle);
```

---

## Pattern Matching

### String Patterns (Exact Match)

```typescript
// Listener
messenger.on('attack', 'handleAttack');

// Matches
messenger.send('attack', null);

// Doesn't match
messenger.send('Attack', null);  // Case-sensitive
messenger.send('attack:melee', null);
```

### RegExp Patterns

```typescript
// Listener
messenger.on(/damage:.*/, 'handleDamage');

// Matches
messenger.send('damage:fire', null);
messenger.send('damage:ice', null);
messenger.send('damage:poison', null);

// Doesn't match
messenger.send('attack', null);
```

### ALL_MESSAGES (Greedy Listener)

```typescript
import { ALL_MESSAGES } from 'omosuen';

// Receives EVERY message regardless of pattern or filters
messenger.on(ALL_MESSAGES, 'logAll');

registerMethod('message-listener', 'logAll', (envelope) => {
    console.log(`[LOG] ${envelope.message}`, envelope.body);
});
```

**Use cases:**
- Message logging
- Debugging
- Audit trails
- Analytics

### ANY_MESSAGES (Filter-Based Listener)

```typescript
import { ANY_MESSAGES } from 'omosuen';

// Receives all messages matching receiver filters (any pattern)
messenger.on(ANY_MESSAGES, 'handleFiltered');

// Receives messages where receiver filters match, regardless of message string
```

**Use cases:**
- Component-specific event logs
- Monitoring all events for specific entity
- Catch-all handlers

---

## Common Patterns

### Combat System

```typescript
// Register combat callbacks
registerMethod('message-listener', 'handleDamage', (envelope) => {
    const target = envelope.receiver as any;
    const damage = envelope.body.damage ?? 0;

    if (target.health) {
        target.health -= damage;
        console.log(`${target.name} took ${damage} damage (${target.health} remaining)`);
    }
});

// Create messengers for entities
const playerMessenger = await newComponent('messenger', {
    name: 'Player Messenger',
    listeners: [
        { pattern: 'damage', callbackKey: 'handleDamage' }
    ]
});

const enemyMessenger = await newComponent('messenger', {
    name: 'Enemy Messenger',
    listeners: [
        { pattern: 'damage', callbackKey: 'handleDamage' }
    ]
});

// Send damage to enemy
playerMessenger.send('damage', {
    mode: 'match-any',
    names: ['Enemy']
}, { damage: 25 });
```

### Event Bus Pattern

```typescript
// Create global event bus
const eventBus = await newComponent('messenger', {
    name: 'Event Bus'
});

// Register handlers
registerMethod('message-listener', 'onGameStart', (envelope) => {
    const level = envelope.body.level ?? 1;
    console.log(`Game starting at level ${level}`);
    loadLevel(level);
});

registerMethod('message-listener', 'onPlayerDied', (envelope) => {
    console.log('Game over!');
    showGameOverScreen();
});

// Subscribe to events
eventBus.on('game:start', 'onGameStart');
eventBus.on('player:died', 'onPlayerDied');

// Broadcast events
eventBus.broadcast('game:start', { level: 1 });
eventBus.broadcast('player:died');
```

### Quest System

```typescript
registerMethod('message-listener', 'updateQuest', (envelope) => {
    const questId = envelope.body.questId;
    const objective = envelope.body.objective;

    console.log(`Quest ${questId}: ${objective} complete`);
    checkQuestCompletion(questId);
});

const questMessenger = await newComponent('messenger', {
    name: 'Quest Messenger',
    listeners: [
        { pattern: /quest:.*/, callbackKey: 'updateQuest' }
    ]
});

// Send quest updates
questMessenger.broadcast('quest:objective', {
    questId: 1,
    objective: 'Collect 10 coins'
});
```

### Debug Logging

```typescript
import { ALL_MESSAGES } from 'omosuen';

registerMethod('message-listener', 'debugLog', (envelope) => {
    console.log('[MESSAGE]', {
        message: envelope.message,
        sender: envelope.sender.name,
        receiver: envelope.receiver.name,
        body: envelope.body
    });
});

const debugMessenger = await newComponent('messenger', {
    name: 'Debug Logger',
    listeners: [
        { pattern: ALL_MESSAGES, callbackKey: 'debugLog' }
    ]
});

// Logs every message in the system
```

---

## Callback Registration

### registerMethod()

Register a message callback function.

```typescript
import { registerMethod } from 'omosuen';

registerMethod('message-listener', 'callbackKey', (envelope) => {
    // Handle message
});
```

**Callback Signature:**

```typescript
type MessageCallback = (envelope: MessageEnvelope) => void;

interface MessageEnvelope {
    message: string;           // Message identifier
    sender: ComponentData;     // Sender messenger
    receiver: ComponentData;   // Matched receiver component
    messenger: ComponentData;  // Messenger handling this message
    body: MessageBody;         // Payload data
}
```

**Example:**

```typescript
registerMethod('message-listener', 'handleAttack', (envelope) => {
    console.log('Message:', envelope.message);
    console.log('Sender:', envelope.sender.name);
    console.log('Receiver:', envelope.receiver.name);
    console.log('Body:', envelope.body);

    // Access payload
    const damage = envelope.body.damage ?? 0;
    const attackType = envelope.body.type ?? 'normal';

    // Process message
    applyDamage(envelope.receiver, damage, attackType);
});
```

---

## Lifecycle

### init()

- Registers all listeners declared in `listeners` array
- Called automatically when messenger is added to scene
- Can be called manually for off-scene messengers

### update()

- Messenger has no update logic
- Message processing happens at the loop level

### dispose()

- Removes all registered listeners
- Clears queued messages from this messenger
- Called automatically when messenger is removed

---

## Best Practices

### 1. Register Callbacks Before Creating Messengers

```typescript
// GOOD
registerMethod('message-listener', 'handleAttack', callback);
const messenger = await newComponent('messenger', {
    listeners: [{ pattern: 'attack', callbackKey: 'handleAttack' }]
});

// BAD - Warns about missing callback
const messenger = await newComponent('messenger', {
    listeners: [{ pattern: 'attack', callbackKey: 'handleAttack' }]
});
registerMethod('message-listener', 'handleAttack', callback);  // Too late!
```

### 2. Use Namespaced Message Names

```typescript
// GOOD - Clear namespace
messenger.send('player:attack', ...);
messenger.send('enemy:died', ...);
messenger.send('quest:complete', ...);

// AVOID - Ambiguous
messenger.send('attack', ...);
messenger.send('died', ...);
```

### 3. Validate Payload Data

```typescript
registerMethod('message-listener', 'handleDamage', (envelope) => {
    // Validate payload
    const damage = envelope.body.damage ?? 0;
    const type = envelope.body.type ?? 'physical';

    if (typeof damage !== 'number' || damage < 0) {
        console.warn('Invalid damage value:', damage);
        return;
    }

    // Process valid damage
    applyDamage(envelope.receiver, damage, type);
});
```

### 4. Use Specific Filters

```typescript
// GOOD - Targeted
messenger.send('damage', {
    mode: 'match-all',
    types: ['nexus'],
    names: ['Enemy']
}, { damage: 10 });

// AVOID - Too broad (hits everything)
messenger.broadcast('damage', { damage: 10 });
```

---

## Performance Notes

- Messages are queued and processed in batches
- Pattern matching uses RegExp test (efficient)
- Module-level registries (minimal per-component overhead)
- Listener lookups are O(n) where n is number of listeners

---

## Serialization

Messenger serializes listener configurations:

```json
{
    "type": "messenger",
    "name": "Player Messenger",
    "listeners": [
        {
            "pattern": "attack",
            "callbackKey": "handleAttack"
        },
        {
            "pattern": {
                "regex": "damage:.*",
                "flags": ""
            },
            "callbackKey": "handleDamage"
        }
    ]
}
```

**Note:** Callbacks must be re-registered after deserialization using `registerMethod()`.

---

## Limitations & Future Work

**Current Status:**
- Send/receive API is complete ✓
- Listener registration works ✓
- Message queueing works ✓
- Pattern matching works ✓

**Not Yet Implemented:**
- Message processing integration with game loop
- Receiver filter matching logic
- Message delivery to listeners

See [src/loop/messaging.ts](../../src/loop/messaging.ts) for implementation status.

---

## Next Steps

- Learn about [Flag Manager](flag-manager.md) for boolean state
- Explore [Data Layer](data-layer.md) for typed storage
- See [Component System](../component-system.md) for custom components

---

**Source:** [src/component/messenger](../../src/component/messenger/)
