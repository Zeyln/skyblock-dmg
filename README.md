# SkyBlock Damage Calculator

A web app that calculates the damage of a single melee or bow hit in Hypixel SkyBlock.

## Scope

Item names, rarities and base stats come live from the public Hypixel items API; pet data comes from the NotEnoughUpdates repo. The calculator covers:

- weapon, armor and equipment, with reforges, recombobulation, stars, gemstones, potato books and enchantments
- pets, accessories (magical power, power stone, tuning), attribute shards, set bonuses and buffs
- dungeons: Catacombs and Master Mode boosts, and dungeon classes
- the target: an in-game enemy or a custom mob type, HP and defense

Game values follow the Hypixel SkyBlock wiki and are kept in `src/data/`.

## Formula

```
Initial      = (5 + Damage) × (1 + Strength / 100)
Additive     = 1 + Σ additive % / 100        enchants, combat level, shards, set bonuses, pets
Multiplier   = Π multiplicative bonuses      weapon bonuses vs mob types, dungeon class, Hedgehog
Defense      = 100 / (100 + Target defense)
Non-crit     = floor(Initial × Additive × Multiplier × Defense)
Crit         = floor(Initial × Additive × Multiplier × (1 + Crit Damage / 100) × Defense)
```

Every stat source is summed into Damage, Strength and Crit Damage first; each bonus then goes into the Additive or Multiplier term depending on how the game stacks it.

## Enemy sprites

The enemy pictures shown in the fight simulation, `public/mobs/`, are the mob renders and head sprites of the [Hypixel SkyBlock Wiki](https://hypixelskyblock.minecraft.wiki/), used under [CC BY-NC-SA 3.0](https://creativecommons.org/licenses/by-nc-sa/3.0/). They are downloaded by `scripts/mob-sprites.mjs`, as the wiki's own resized thumbnails. The textures themselves are Minecraft's, © Mojang; this is an unofficial, non-commercial fan project, not affiliated with Hypixel or Mojang.

## Font

All text uses a Minecraft-style pixel font, `public/fonts/marlowww.otf`. It was converted (ASCII glyphs only) from the font textures of the MIT-licensed resource pack [Marlowww Texture pack PVP & More](https://modrinth.com/resourcepack/totem-of-marlowww) by btwreynahd; the license notice is in `public/fonts/LICENSE-marlowww.txt`.
