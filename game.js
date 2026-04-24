'use strict';

// ============================================================
// Cloud Jumper — game.js
// Single-file vanilla JS, no modules. GSAP loaded from CDN
// (script tag with defer); used only for UI overlay tweens.
// ============================================================


// ---------- Asset manifest ----------
const ASSETS = {
    pandaLeft: 'assets/panda-facing-left.png',
    pandaLeftJetpack: 'assets/panda-facing-left-with-jetpack.png',
    pandaArmRaygun: 'assets/guns/raygun/panda-arm-holding-raygun.png',
    pandaArmM16:    'assets/guns/m16/panda-arm-holding-m16.png',
    pandaArmVectorSmg: 'assets/guns/vector-smg/panda-arm-holding-vector-smg.png',
    pandaArmBazooka: 'assets/guns/Bazooka/panda-arm-holding-bazooka.png',
    pandaArmMinigun: 'assets/guns/minigun/panda-arm-holding-minigun.png',
    bazookaRocket:   'assets/guns/Bazooka/projectile.png',
    clouds: ['assets/clouds/cloud-1.png', 'assets/clouds/cloud-2.png'],
    darkClouds: ['assets/clouds/dark-cloud-1.png', 'assets/clouds/dark-cloud-2.png'],
    bullet: 'assets/mario-bullet.png',
    bulletKingBill: 'assets/mario-bullet-large.png',
    bulletMissile: 'assets/mario-missile-bullet.png',
    birdFacingRight: 'assets/bird-facing-right.gif',
    jetpack: 'assets/jetpack.png',
    coin: 'assets/coin.png',
    jumpSound: 'assets/jump-sound.mp3',
    // Fire SFX use arrays so a weapon can have multiple shot variants.
    // AudioPool picks a random variant per shot (never repeating the last
    // one back-to-back). Single-variant guns are one-element arrays.
    m16Fire:       ['assets/guns/m16/sounds/m16-single-shot.mp3'],
    vectorSmgFire: ['assets/guns/vector-smg/sounds/vector-smg-single-shot.mp3'],
    raygunFire: [
        'assets/guns/raygun/sounds/raygun-single-shot-1.mp3',
        'assets/guns/raygun/sounds/raygun-single-shot-2.mp3',
        'assets/guns/raygun/sounds/raygun-single-shot-3.mp3'
    ],
    // Bazooka has one fire clip, but two explosion variants. The explosion
    // pool is built with `noRepeat: false` so the two clips are rolled
    // independently and the same one can play twice in a row.
    bazookaFire: ['assets/guns/Bazooka/sounds/bazooka-fire-shot.mp3'],
    bazookaExplosion: [
        'assets/guns/Bazooka/sounds/bazooka-fire-explosion.mp3',
        'assets/guns/Bazooka/sounds/explosion-1.mp3'
    ],
    // Minigun uses a pre-fire / sustained-fire / post-fire trio instead of
    // per-shot SFX. Any weapon whose config declares `preFireSoundKey`,
    // `sustainedFireSoundKey`, and/or `postFireSoundKey` will play its whole
    // fire cycle as one soundtrack rather than emitting a clip per round.
    minigunStart:    'assets/guns/minigun/sounds/start.mp3',
    minigunShooting: 'assets/guns/minigun/sounds/shooting.mp3',
    minigunEnding:   'assets/guns/minigun/sounds/ending.mp3',
    minigunOverheat: 'assets/guns/minigun/sounds/overheat.mp3'
};

// ---------- Tunable constants ----------
// World-space zoom factor. <1 widens the FOV (more of the world fits on
// screen; everything renders proportionally smaller). >1 zooms in.
// Everything in the game — physics, spawn checks, camera — operates in
// *logical* px; the final ctx transform maps logical → CSS by this factor.
// Mutated at runtime by the Settings overlay slider — Game applies the
// saved setting on boot and calls handleResize() to flow the change
// through viewport / managers / input. Clamped to [ZOOM_MIN, ZOOM_MAX].
let WORLD_ZOOM = 0.75;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 1.5;
// The user-facing zoom slider is *baselined to a 1080p screen*: on a
// 1080p monitor, settings.zoom IS the effective zoom. On larger (or
// smaller) monitors we scale it so the world viewport stays the same
// size in world units — i.e. the game "looks" the same everywhere.
// Height-based because the game is primarily vertical: a 1440p screen
// gets ×1.33, 4K gets ×2. Ultrawides still see wider horizontal field,
// which is what an ultrawide user wants.
const ZOOM_REFERENCE_HEIGHT = 1080;
function zoomResolutionScale() {
    return window.innerHeight / ZOOM_REFERENCE_HEIGHT;
}
function effectiveWorldZoom(baselineZoom) {
    return baselineZoom * zoomResolutionScale();
}

// Horizontal-movement sensitivity. Scales both the per-frame ease factor
// and the max-step cap in Player.update, so 2.0 feels twice as snappy as
// 1.0. Tuned via Settings slider; default 1.0 = current baseline.
let SENSITIVITY = 1.2;
const SENSITIVITY_MIN = 0.5;
const SENSITIVITY_MAX = 2.0;

// Dwell time (ms) the auto-aim must stay locked on a single target before
// the red crosshair appears. Keeps the marker from strobing when many
// enemies are close together or when automatic fire rapidly swaps targets.
// Split into two phases: LOCK is when shots actually start homing /
// tracking the aimed target (aim-assist engages). HIT_MARKER is when
// the crosshair visual appears. Keeping them separate lets the
// mechanical lock trigger slightly before the marker so the crosshair
// reads as "confirmed lock" rather than "now try to fire".
const AIM_LOCK_DELAY_MS   = 100;
const HIT_MARKER_DELAY_MS = 150;

const PHYSICS = {
    gravity: 0.5,           // px / frame²  (1800 px/s² at 60fps)
    jumpVelocity: -24,      // px / frame   (base apex ≈ 576 px; actual jump multiplied by cloud.springMult)
    horizontalEaseAlpha: 0.2,
    horizontalMaxStep: 14,  // cap per-frame horizontal movement
    terminalVelocity: 24,
    facingDeadzone: 0.5
};

const DOUBLE_JUMP_MULT = 0.70;  // in-air hop (Space). Granted by cloud landings only.
const DOUBLE_JUMP_LOCKOUT_MS = 400;  // cannot double jump within this window of getting the recharge

// ---------- Jetpack (rare pickup) ----------
const JETPACK_PICKUP_WIDTH   = 70;    // fixed px — not difficulty-scaled
const JETPACK_BURN_SECONDS   = 4;     // full-fuel → empty at continuous F-thrust
const JETPACK_IDLE_SECONDS   = 20;    // full-fuel → empty without pressing F
const JETPACK_THRUST_ACCEL   = 1.1;   // px/frame² upward (beats gravity 0.5)
const JETPACK_MAX_UP_VY      = -20;   // capped upward vy during thrust (px/frame)
// Exhaust emit point. 0.5 = at sprite edge, >0.5 = outside the sprite.
// Y is fraction from sprite TOP; 0.82 ≈ 18% from the bottom. Tune freely.
const JETPACK_EXHAUST_X_FRAC = 0.33;
const JETPACK_EXHAUST_Y_FRAC = 0.80;

// ---------- Arm + weapons (testing: raygun equipped by default; later becomes a pickup) ----------
// Each weapon is a flat config: arm rig + barrel offset + projectile + kill rules.
// Pivot is in PLAYER body coords. Arm renders BEHIND the body (panda covers the
// shoulder), so the arm reads as the panda's front-side limb sticking out.
// Future weapons (M16, etc.) get their own entry here with their own arm tuning.
const WEAPONS = {
    raygun: {
        spriteKey: 'pandaArmRaygun',     // AssetLoader key
        // Arm rig (player-body coord fractions) — sized to match M16 so the
        // raygun reads as a proper chunky weapon rather than a small pistol.
        armPivotXFrac: 0.33,             // deeper into body — bigger arm needs more anchor
        armPivotYFrac: 0.52,             // a touch below center so the gun hangs naturally
        armWidthFrac:  1.55,             // match M16 scale
        imgPivotXFrac: 0.92,             // shoulder pivot in the arm IMAGE (body-end)
        imgPivotYFrac: 0.50,
        angleUpDeg:    60,               // max upward rotation (positive = aim UP)
        angleDownDeg:  75,               // max downward rotation (negative = aim DOWN)
        pivotTuckAtLimitFrac: 0.08,      // pivot slides into body at angle extremes
        // Barrel point in arm IMAGE coords (top-left = 0,0)
        barrelImgXFrac: 0.00,            // leftmost edge of the arm (gun tip)
        barrelImgYFrac: 0.20,            // 20% from top of arm
        // Firing — semi-automatic: each click fires one shot, with a cooldown
        // floor. Holding the mouse does NOT fire continuously.
        autoFire:          false,
        fireCooldownMs:    350,
        // Per-shot SFX — AudioPool key on Game.weaponAudio. The raygun entry
        // has 3 variants so AudioPool picks a different one each shot.
        fireSoundKey:      'raygunFire',
        fireSoundVolume:   0.20,
        maxLockRangePx:   1300,      // raygun's auto-aim can lock onto targets up to this distance from the arm pivot (px)
        // Idle behavior (only when no target is being auto-aimed at):
        // a slow up/down sine bob plus a tilt-upward when the panda is rising.
        idleBobAmplitudeDeg: 8,
        idleBobPeriodMs:     3000,
        jumpTiltVyScale:     1.2,
        jumpTiltMaxDeg:      40,
        // Projectile visuals (Black Ops Ray Gun green plasma orb).
        // Drawn as three concentric oriented ellipses: long axis along motion,
        // short axis perpendicular — reads as a stretched 2D bolt, not a line.
        projectileSpeed:      1600,
        // Medium range — further than the original 350ms fizzle, but the
        // bolt still fades out well before reaching M16 tracer distance.
        projectileLifeMs:     600,
        projectileLongPx:     40,
        projectileWidthPx:    16,
        projectileColorCore:  '#d8ffc4',
        projectileColorGlow:  '#5fff3f',
        projectileColorOuter: 'rgba(120, 255, 80, 0.30)',
        // Forgiveness: extra radius added to the target's own collision radius
        // when checking hits. Raygun is generous; M16 is tighter.
        projectileHitRadius:  22,
        // Muzzle/impact effect kind — 'sparkle' = plasma sparkles tinted by
        // muzzleFlashHue; 'smoke' = small grey puff (no sparkles).
        muzzleEffect:         'sparkle',
        muzzleFlashHue:       125,
        // Kill rules — raygun one-shots every enemy, including KingBill.
        canKillNormalBullet: true,
        canKillMissile:      true,
        canKillBird:         true,
        canKillKingBill:     true,
        hitsToKillMissile:   1,
        hitsToKillKingBill:  1,
        // Score per kill type. Mirrors stomp economy where applicable.
        pointsNormal:   100,
        pointsMissile:  750,
        pointsKingBill: 600,
        pointsBird:     500
    },

    m16: {
        spriteKey: 'pandaArmM16',
        // Arm rig — bigger than raygun (M16 is a heavier weapon). Pivot is
        // nudged deeper into the body and a touch lower so the larger arm
        // stays anchored on the shoulder instead of overhanging the panda.
        armPivotXFrac: 0.33,             // deeper into body — bigger arm needs more anchor
        armPivotYFrac: 0.52,             // a touch below center so the rifle hangs naturally
        armWidthFrac:  1.55,             // ~30% bigger than before
        imgPivotXFrac: 0.92,
        imgPivotYFrac: 0.50,
        angleUpDeg:    60,
        angleDownDeg:  75,
        pivotTuckAtLimitFrac: 0.08,
        // Barrel — same spot as raygun for now.
        barrelImgXFrac: -0.25,
        barrelImgYFrac: 0.30,
        maxLockRangePx: 1600,
        // Firing — fully automatic: a soft click fires exactly one round;
        // holding past `autoFireHoldDelayMs` starts cyclic fire at the
        // cooldown rate. The hold delay is what distinguishes a tap from
        // an intentional hold (FPS-style).
        autoFire:              true,
        fireCooldownMs:        80,       // ~11 rounds/sec — M16 cyclic feel
        autoFireHoldDelayMs:   100,      // hold this long for continuous fire
        // Per-shot SFX (AudioPool key on Game.weaponAudio). Omit for silent.
        fireSoundKey:      'm16Fire',
        fireSoundVolume:   0.35,
        // Idle behavior — same gentle bob/jump-tilt as raygun.
        idleBobAmplitudeDeg: 8,
        idleBobPeriodMs:     3000,
        jumpTiltVyScale:     1.2,
        jumpTiltMaxDeg:      40,
        // Projectile — tiny, fast, full-range. projectileLifeMs is generous
        // enough that bullets reach the screen edge before despawning; the
        // off-screen check in PlasmaShot.isOffscreen culls them naturally.
        projectileSpeed:      2400,
        projectileLifeMs:     5000,
        // Ballistic drop (px/s² applied to vy). Heavy 5.56 round: noticeable
        // arc past ~800 px but still lands close-to-target at mid range.
        projectileGravity:    300,
        projectileLongPx:     28,        // meaty tracer round — easy to read in flight
        projectileWidthPx:    9,
        projectileColorCore:  '#ffffff',
        projectileColorGlow:  '#ffcf00', // saturated gold glow
        projectileColorOuter: 'rgba(255, 150, 40, 0.55)',  // stronger warm halo
        // Tighter hitbox than raygun so M16 rewards aim, but still forgiving
        // enough that the chunky tracer matches its effective hit area.
        projectileHitRadius:  13,
        // M16 uses small grey smoke puffs at the muzzle and on damage scuffs
        // (kill explosions are still warm sparks via spawnExplosion). The
        // hue field is unused for 'smoke' mode but kept so a future variant
        // can swap back to sparkles trivially.
        muzzleEffect:         'smoke',
        muzzleFlashHue:       50,
        // Kill rules
        canKillNormalBullet: true,
        canKillMissile:      true,
        canKillBird:         true,
        canKillKingBill:     true,
        // Missiles take 2 M16 rounds — same as raygun. KingBill is armored
        // and needs 4 rounds to down.
        hitsToKillMissile:   2,
        hitsToKillKingBill:  3,
        pointsNormal:   100,
        pointsMissile:  750,
        pointsKingBill: 600,
        pointsBird:     500
    },

    // Vector SMG — high ROF, low-damage-per-shot variant of the M16. Shares
    // the M16's arm geometry (same rig feels right for this panda) but
    // fires faster and each round does less damage, so the player has to
    // land more hits for a kill. Intentionally can't dent a KingBill — its
    // bullets are too light to penetrate the heavy armor.
    vectorSmg: {
        spriteKey: 'pandaArmVectorSmg',
        // Arm rig — identical to M16 so switching guns doesn't reposition
        // the arm awkwardly (same pivot, same reach cone).
        armPivotXFrac: 0.33,
        armPivotYFrac: 0.52,
        armWidthFrac:  1.55,
        imgPivotXFrac: 0.92,
        imgPivotYFrac: 0.50,
        angleUpDeg:    60,
        angleDownDeg:  75,
        pivotTuckAtLimitFrac: 0.08,
        barrelImgXFrac: -0.15,
        barrelImgYFrac: 0.25,
        // Firing — full-auto with a much snappier cadence than the M16.
        // 50ms ≈ 20 rps (Vector's real-world cyclic range is 15-20 rps).
        autoFire:              true,
        fireCooldownMs:        50,
        autoFireHoldDelayMs:   100,
        // Per-shot SFX.
        fireSoundKey:      'vectorSmgFire',
        fireSoundVolume:   0.4,        // a touch quieter — 2x the ROF, don't overwhelm
        // SMG rounds are light — auto-aim won't lock onto anything
        // beyond 1000px so the player has to close the distance for
        // far targets (rifles still reach out, this is a deliberate
        // short/medium-range cap).
        maxLockRangePx:    1150,
        // Idle behavior mirrors M16.
        idleBobAmplitudeDeg: 8,
        idleBobPeriodMs:     3000,
        jumpTiltVyScale:     1.2,
        jumpTiltMaxDeg:      40,
        // Projectile — same warm gold tracer look as the M16 so it reads as
        // a real bullet, just a bit shorter and thinner to sell "lighter
        // round, faster cadence". Same speed/life so aiming feel stays
        // consistent between the two guns.
        projectileSpeed:      2400,
        projectileLifeMs:     5000,
        // Lighter 9mm round — drops faster than the M16's 5.56. Tuned so
        // close/mid-range auto-aim still lands reliably but long shots arc.
        projectileGravity:    450,
        projectileLongPx:     20,
        projectileWidthPx:    6,
        projectileColorCore:  '#ffffff',
        projectileColorGlow:  '#ffcf00',                 // saturated gold glow (matches M16)
        projectileColorOuter: 'rgba(255, 150, 40, 0.55)',
        projectileHitRadius:  10,
        muzzleEffect:         'smoke',
        muzzleFlashHue:       50,
        // Kill rules — can't kill KingBill (bullets too light).
        canKillNormalBullet: true,
        canKillMissile:      true,
        canKillBird:         true,
        canKillKingBill:     true,
        // Light bullets: normal bullets take 2 hits, missiles take 5. Bird
        // still dies in 1 hit (it's already stomp-killable — one-shot
        // matches the stomp economy).
        hitsToKillNormal:    2,
        hitsToKillMissile:   4,
        hitsToKillKingBill: 10,
        pointsNormal:  100,
        pointsMissile: 750,
        pointsBird:    500
    },

    // Bazooka — M202-flavoured homing rocket launcher. Projectile is an
    // image sprite (not the drawn plasma oval) that locks onto whatever
    // auto-aim picked at fire time and homes until impact or fuse-expiry.
    // On detonation it deals AoE splash damage within `splashRadiusPx`
    // centered on the ROCKET'S position (not the target's) — every
    // eligible enemy inside the radius dies in one shot and awards its
    // own points. Straight (non-homing) shots fired with no auto-aim
    // target just fly off-screen if they miss — no fuse-detonation so
    // the player isn't rewarded for random sky-shots.
    bazooka: {
        spriteKey: 'pandaArmBazooka',
        // Arm rig — bigger than M16 so the chunky launcher reads as a
        // heavy weapon. Pivot sits deeper into the body and a touch
        // lower than M16 so the extra length doesn't overhang the
        // shoulder.
        armPivotXFrac: 0.35,
        armPivotYFrac: 0.53,
        armWidthFrac:  1.75,
        imgPivotXFrac: 0.92,
        imgPivotYFrac: 0.50,
        angleUpDeg:    60,
        angleDownDeg:  75,
        pivotTuckAtLimitFrac: 0.08,
        // Barrel muzzle position in the arm IMAGE coords.
        barrelImgXFrac: 0.00,
        barrelImgYFrac: 0.20,
        // Firing — semi-auto with a long cooldown (feels weighty).
        autoFire:          false,
        fireCooldownMs:    350,
        fireSoundKey:      'bazookaFire',
        fireSoundVolume:   0.5,
        // Auto-aim can only LOCK onto targets within this distance from
        // the arm pivot. A rocket fired in a direction where something
        // happens to be in its path still detonates on contact — this
        // purely limits tracking range, not hit range. Shared plumbing:
        // any weapon can set `maxLockRangePx` to cap its auto-aim reach.
        maxLockRangePx:    1300,
        // Idle motion — same bob/jump tilt as M16/raygun so the arm reads
        // consistent across weapons when nothing is being auto-aimed at.
        idleBobAmplitudeDeg: 8,
        idleBobPeriodMs:     3000,
        jumpTiltVyScale:     1.2,
        jumpTiltMaxDeg:      40,
        // ---- Projectile kind discriminator ----
        // WeaponSystem branches on this: 'plasma' (default, drawn oval)
        // vs 'rocket' (image sprite + homing + splash).
        projectileKind: 'rocket',
        // ---- Rocket tunables ----
        rocketSpriteKey:          'bazookaRocket',
        rocketWidthPx:            56,        // sprite size on screen (length)
        rocketHeightPx:           20,        // sprite size on screen (width)
        rocketSpeed:              900,       // px/sec — slower than bullets so homing reads
        rocketTurnRateDegPerSec:  720,       // nimble — full rotation in half a sec, so the rocket can curl sharply onto a dodging target
        rocketLifeMs:             2500,      // fuse: homing rockets detonate on expiry
        // Smoke/fire trail emitted behind the rocket each tick. Trail is
        // deliberately smaller than bullet trails so the rocket reads as a
        // single projectile rather than a rolling cloud.
        rocketSmokeEmitEveryMs:   28,
        rocketSmokeScale:         0.45,      // grey puff scale (bullet = 1.0)
        rocketFireScale:          0.35,      // warm flame core scale
        // Emission offset along the rocket axis (fraction of rocketWidthPx,
        // positive = backward from the head). Also a perpendicular offset
        // as a fraction of rocketHeightPx so the trail can sit slightly
        // above/below the centerline if the sprite's exhaust port isn't
        // centered. Tune both to anchor the trail on the rocket's tail art.
        rocketSmokeTailAxisFrac:  0.50,
        rocketSmokeTailCrossFrac: 0.00,
        // ---- Splash damage ----
        // Radius around the DETONATION POINT (rocket.x/y at impact, not
        // the target's current position) inside which every eligible enemy
        // is killed. Tune up for bigger AoE.
        splashRadiusPx:           140,
        explosionSoundKey:        'bazookaExplosion',
        explosionSoundVolume:     0.55,
        // Muzzle FX kind when firing — the bazooka uses a puff of smoke +
        // a small fire kicker at the barrel.
        muzzleEffect:  'smoke',
        muzzleFlashHue: 40,
        // Kill rules — one-shots everything via splash.
        canKillNormalBullet: true,
        canKillMissile:      true,
        canKillBird:         true,
        canKillKingBill:     true,
        hitsToKillMissile:   1,
        hitsToKillKingBill:  1,
        pointsNormal:   100,
        pointsMissile:  750,
        pointsKingBill: 600,
        pointsBird:     500
        // FUTURE: self-damage scaffolding. When a player health/HP system
        // lands, add `splashPlayerDamage` here and check `player.x/y` vs
        // `splashRadiusPx` inside WeaponSystem._detonateRocket.
    },

    // Minigun — legendary "bullet hose". Cyclic rate well above the Vector
    // SMG, but each round is a weak, slow slug that drops fast. Close-range
    // only: the lock range is SMG-tier and the heavy gravity makes long
    // shots arc into the ground. No fire SFX yet (fireSoundKey omitted).
    minigun: {
        spriteKey: 'pandaArmMinigun',
        // Arm rig — minigun is the beefiest weapon: larger than the
        // bazooka on screen. Pivot sits deeper into the body and a touch
        // lower so the extra bulk doesn't overhang the shoulder.
        armPivotXFrac: 0.42,
        armPivotYFrac: 0.57,
        armWidthFrac:  2.70,
        imgPivotXFrac: 0.92,
        imgPivotYFrac: 0.50,
        angleUpDeg:    60,
        angleDownDeg:  75,
        pivotTuckAtLimitFrac: 0.08,
        barrelImgXFrac: -0.10,
        barrelImgYFrac: 0.40,
        // Rotating-barrel trio (generic scaffolding — any weapon can set
        // `barrelOffsets` to fire from multiple muzzle points per trigger
        // tick). Each offset is `{ xFrac, yFrac }` in arm-image coords,
        // same frame as `barrelImgXFrac/YFrac` (which stays as the
        // single-barrel fallback used by every other weapon). The salvo
        // fires barrel 0 instantly; remaining barrels are queued with
        // `barrelStaggerMs` between them. Each queued shot is a fully
        // independent PlasmaShot — any of the three can land a hit.
        barrelOffsets: [
            { xFrac: -0.10, yFrac: 0.22 },   // top barrel
            { xFrac: -0.10, yFrac: 0.40 },   // middle (matches the old single point)
            { xFrac: -0.10, yFrac: 0.58 }    // bottom barrel
        ],
        barrelStaggerMs: 5,
        // Firing — full-auto, ~50 rps. A tap fires one round; holding past
        // autoFireHoldDelayMs opens up the hose.
        autoFire:              true,
        fireCooldownMs:        20,
        autoFireHoldDelayMs:   100,
        // Overheat — sustained fire builds heat (1 per shot). At the cap the
        // weapon locks out until heat drops back below `overheatResumeAt`.
        // Heat bookkeeping:
        //   - While firing OR within `overheatIdleGraceMs` of the last
        //     shot, heat is FROZEN. This stops the player from spam-tap
        //     firing to skirt the overheat (short pauses now carry heat
        //     forward instead of resetting it).
        //   - After the grace window (long pause), heat decays at
        //     `overheatDecayPerSec` — the gun "cools" only on sustained
        //     idle.
        //   - During an active overheat lockout, heat ALWAYS decays
        //     regardless of grace, so the trigger eventually unlocks.
        // Tuning: ~0.8 s of sustained fire hits the cap; the 0.6 s grace
        // lets taps stack; full cool from cap takes ~1.05 s.
        overheatMaxShots:      40,
        overheatResumeAt:      10,
        overheatDecayPerSec:   28,
        overheatIdleGraceMs:   600,
        // Overheat FX — while the weapon is locked out, emit a thick plume
        // of grey smoke + warm flame at each barrel (or at the default
        // barrel point if `barrelOffsets` isn't set).
        //   overheatSmokeEmitEveryMs — cadence between emissions (ms)
        //   overheatSmokeScale/FireScale — base size of each puff
        //   overheatSmokeBurstCount — puffs spawned per barrel per tick
        //                             (jittered in position for a fuller cloud)
        //   overheatInitialBurstScale — explosion-sized kick the instant
        //                               the weapon transitions to overheated
        overheatSmokeEmitEveryMs:  22,
        overheatSmokeScale:        1.35,
        overheatFireScale:         1.10,
        overheatSmokeBurstCount:   3,
        overheatInitialBurstScale: 2.0,
        // Played once at the moment of overheat (generic — any overheat
        // weapon can set these).
        overheatSoundKey:     'minigunOverheat',
        overheatSoundVolume:  0.85,
        // Hold the overheat SFX until after the ending (post-fire) clip
        // has had a chance to finish, otherwise the two step on each other.
        overheatSoundDelayMs: 400,
        // Sustained-fire audio cycle (generic scaffolding — any weapon can
        // opt in by declaring these keys):
        //   preFireSoundKey     → played once when the trigger is first held
        //   preFireDelayMs      → wait this long AFTER preFire starts before
        //                         the first round actually fires (barrel spin-up)
        //   sustainedFireSoundKey → played once when real firing begins and
        //                         stopped when the cycle ends (used INSTEAD of
        //                         per-shot `fireSoundKey`)
        //   postFireSoundKey    → played once when the cycle ends (released,
        //                         overheated, paused, etc.)
        // Each has an optional `*Volume` sibling (defaults to 0.4).
        preFireSoundKey:          'minigunStart',
        preFireSoundVolume:       0.5,
        preFireDelayMs:           250,
        sustainedFireSoundKey:    'minigunShooting',
        sustainedFireSoundVolume: 0.5,
        postFireSoundKey:         'minigunEnding',
        postFireSoundVolume:      0.5,
        // Mid-range reach — further than the SMG, still short of rifles.
        maxLockRangePx:    1400,
        idleBobAmplitudeDeg: 8,
        idleBobPeriodMs:     3000,
        jumpTiltVyScale:     1.2,
        jumpTiltMaxDeg:      40,
        // Projectile — underpowered round: slower than rifle bullets and
        // drops fast, so firing into the distance visibly arcs into the
        // abyss. Close-range fire still lands reliably because the lock
        // range caps the target envelope.
        projectileSpeed:      1500,
        projectileLifeMs:     4000,
        projectileGravity:    180,
        projectileLongPx:     18,
        projectileWidthPx:    6,
        projectileColorCore:  '#ffffff',
        projectileColorGlow:  '#ffcf00',
        projectileColorOuter: 'rgba(255, 150, 40, 0.55)',
        projectileHitRadius:  10,
        muzzleEffect:         'smoke',
        muzzleFlashHue:       50,
        // Kill rules — high ROF compensates for low per-shot damage. Each
        // slug is too light to dent a KingBill meaningfully, so it takes
        // many rounds to chew through one.
        canKillNormalBullet: true,
        canKillMissile:      true,
        canKillBird:         true,
        canKillKingBill:     true,
        hitsToKillNormal:    4,
        hitsToKillMissile:   8,
        hitsToKillKingBill: 14,
        pointsNormal:  100,
        pointsMissile: 750,
        pointsKingBill: 600,
        pointsBird:    500
    }
};

// Shop-driven: null by default (fresh browser = no weapon). Kept as a debug
// override so devs can force-equip from code by replacing this constant — the
// runtime boot path reads `settings.equippedWeapon` first, then falls through
// to this. Leaving `ARM_DEFAULT_EQUIPPED = false` below disables the override.
const DEFAULT_EQUIPPED_WEAPON = null;
const ARM_DEFAULT_EQUIPPED    = false;
// Aim is the angle from arm pivot to the nearest valid target each frame,
// smoothed via easeStep so the swing reads as fast (~3 frames) but not jarring.
const ARM_AIM_LERP            = 0.55;
// Proximity override: if ANY reachable enemy the weapon can kill is within
// this distance of the arm pivot, auto-aim locks onto the closest one
// regardless of tier (missile/KingBill/bullet/bird). Beyond this radius the
// normal tier priority kicks in. Tune up/down to change "panic range".
const ARM_AIM_PROXIMITY_PX    = 300;
// Outside the proximity override, tier priority (missile > kingBill >
// normal > bird > retired) normally picks the target. If a LOWER-tier
// candidate is at least this many pixels closer to the arm pivot than
// the current top-tier pick, it steals the lock. Cascades — the new
// best can itself be beaten by a further-down tier if that one is
// meaningfully closer again. Tune up to make the game "stick to"
// priority more; tune down to make aim chase the nearest threat.
const ARM_AIM_TIER_OVERRIDE_PX = 150;

// ---------- Shop catalog ----------
// Display-only metadata for the Shop modal. The weapon `key` either maps to a
// WEAPONS entry (the arm sprite + physics) or is `null` for the "No Weapon"
// card. The `image` path is what the shop card renders (not the arm overlay).
// Adding a new weapon is: add to WEAPONS, then add a row here.
const RARITY = {
    legendary: { label: 'Legendary', color: 'rgb(255, 234, 0)' },
    rare:      { label: 'Rare',      color: 'rgb(76, 95, 196)' }
};
// Source-of-truth list. Visual ordering in the shop is computed in
// ShopUI._sortedItems() — No Weapon pinned first, legendary always last,
// price-desc within each rarity tier. Add new rows here in any order.
const SHOP_ITEMS = [
    { key: null,        name: 'No Weapon',  image: null,                                                price: 0,   rarity: null        },
    { key: 'm16',       name: 'M16',        image: 'assets/guns/m16/m16-orginal.png',                   price: 2, rarity: 'legendary' },
    { key: 'raygun',    name: 'Raygun',     image: 'assets/guns/raygun/raygun-orginal.png',             price: 2, rarity: 'legendary' },
    { key: 'vectorSmg', name: 'Vector SMG', image: 'assets/guns/vector-smg/vector-smg-orginal.png',     price: 1, rarity: 'rare'      },
    { key: 'bazooka',   name: 'Bazooka',    image: 'assets/guns/Bazooka/bazooka-orginal.png',           price: 2, rarity: 'legendary' },
    { key: 'minigun',   name: 'Minigun',    image: 'assets/guns/minigun/minigun-orginial.png',          price: 2, rarity: 'legendary' }
];

const CAMERA_CFG = {
    softThreshold: 0.40,
    hardThreshold: 0.20,
    ease: 0.12
};

const CLOUD_VANISH_FRAMES = 18;
const CLOUD_HITBOX_DEPTH = 0.15;     // hitbox starts 15% into sprite (so panda lands ON top fluff)
const FOOT_INSET = 8;
const PLAYER_BASE_HEIGHT = 110;
const PLAYER_MIN_VIEWPORT_RATIO = 0.13;

const HIGHSCORE_KEY = 'cloudjumper.highscore';
const MUTE_KEY = 'cloudjumper.muted';
const SETTINGS_KEY = 'cloudjumper.settings';

// Coin balance is persisted as `<balance>.<hmac-hex>` with SHA-256 HMAC'd
// using a key baked into this file. That's obfuscation, not real security
// (anyone who opens game.js can forge a payload), but it blocks casual
// manual edits ("oh, let me just change coinBalance=9999").
//
// Storage: localStorage is the primary because it persists reliably on
// file:// (where the game is typically opened via double-click on
// index.html). A cookie is written alongside as a secondary so the value
// still shows up in DevTools → Application → Cookies when the page is
// served over http(s). On load we accept whichever source has a valid
// HMAC, preferring the higher balance if both are valid but disagree.
const COIN_STORAGE_KEY = 'cloudjumper.coins';
const COIN_COOKIE_KEY = 'cj_coins';
const COIN_HMAC_SECRET = 'cj_v1_7b3a9e4d_panda_bounce_keys_not_for_copy_paste';

async function _coinHmacHex(message) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        'raw', enc.encode(COIN_HMAC_SECRET),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    const bytes = new Uint8Array(sig);
    let out = '';
    for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, '0');
    return out;
}
function _readCookie(name) {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : null;
}
function _writeCookie(name, value) {
    const d = new Date(Date.now() + 5 * 365 * 86400 * 1000);   // 5-year horizon
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${d.toUTCString()}; path=/; SameSite=Lax`;
}
// Returns the verified integer balance from a signed `<bal>.<hmac>` payload,
// or null if the payload is missing, malformed, or the HMAC doesn't match.
async function _verifySignedBalance(raw) {
    if (!raw) return null;
    const dot = raw.lastIndexOf('.');
    if (dot <= 0) return null;
    const balStr = raw.slice(0, dot);
    const sig    = raw.slice(dot + 1);
    const expected = await _coinHmacHex(balStr);
    if (expected !== sig) return null;
    const n = parseInt(balStr, 10);
    return Number.isFinite(n) && n >= 0 ? n : null;
}
async function loadCoinBalance() {
    let fromLocal = null, fromCookie = null;
    try { fromLocal  = await _verifySignedBalance(localStorage.getItem(COIN_STORAGE_KEY)); } catch (e) {}
    try { fromCookie = await _verifySignedBalance(_readCookie(COIN_COOKIE_KEY));           } catch (e) {}
    // If both are valid we trust the higher of the two (covers the case
    // where one store was cleared and the other wasn't — we never want to
    // silently lose coins). If neither is valid, start fresh at 0.
    if (fromLocal == null && fromCookie == null) return 0;
    if (fromLocal == null)  return fromCookie;
    if (fromCookie == null) return fromLocal;
    return Math.max(fromLocal, fromCookie);
}
async function saveCoinBalance(balance) {
    const balStr = String(Math.max(0, Math.floor(balance)));
    let sig;
    try { sig = await _coinHmacHex(balStr); } catch (e) { return; }
    const payload = `${balStr}.${sig}`;
    try { localStorage.setItem(COIN_STORAGE_KEY, payload); } catch (e) { /* private mode / quota */ }
    try { _writeCookie(COIN_COOKIE_KEY, payload);          } catch (e) { /* cookies disabled */ }
}

// Background-music registry. Add new tracks here — a track-picker UI can
// wire into the same list without touching the player code.
const MUSIC_TRACKS = [
    { key: 'music-1', name: 'Cloud Drift', src: 'assets/music/music-1.mp3' }
];
const DEFAULT_MUSIC_TRACK = 'music-1';

const DEFAULT_SETTINGS = {
    doubleJump: true,
    hideCursor: true,
    difficulty: 'normal',  // 'easy' | 'normal' | 'hard'
    zoom: 0.75,             // WORLD_ZOOM — tuned via Settings slider
    sensitivity: 1.2,      // SENSITIVITY — tuned via Settings slider
    showHitMarker: true,   // red crosshair on dwell-locked auto-aim targets
    // Background music state
    musicEnabled: true,
    musicVolume: 0.15,
    musicTrack: DEFAULT_MUSIC_TRACK,
    // Shop state. `ownedWeapons` is the purchase ledger; `equippedWeapon` is
    // the key passed to Player.equipWeapon() on boot (null = No Weapon).
    ownedWeapons: [],
    equippedWeapon: null
};


// ============================================================
// Math helpers
// ============================================================

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => v < lo ? lo : v > hi ? hi : v;
const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};
// Frame-rate-independent ease: equivalent of step applications of factor alpha.
const easeStep = (alpha, step) => 1 - Math.pow(1 - alpha, step);
const randRange = (a, b) => a + Math.random() * (b - a);
const choice = arr => arr[Math.floor(Math.random() * arr.length)];

function hexToRgb(c) {
    if (c[0] === '#') c = c.slice(1);
    return [parseInt(c.slice(0, 2), 16), parseInt(c.slice(2, 4), 16), parseInt(c.slice(4, 6), 16)];
}
function lerpColor(c1, c2, t) {
    const a = hexToRgb(c1), b = hexToRgb(c2);
    return `rgb(${(lerp(a[0], b[0], t)) | 0}, ${(lerp(a[1], b[1], t)) | 0}, ${(lerp(a[2], b[2], t)) | 0})`;
}

// Build a jagged polyline from (x1,y1) to (x2,y2) for lightning-bolt rendering.
// Jitter tapers to zero at the endpoints so the bolt attaches cleanly.
function makeBolt(x1, y1, x2, y2, jitter) {
    const dx = x2 - x1, dy = y2 - y1;
    const dist = Math.hypot(dx, dy) || 0.0001;
    const segments = Math.max(2, Math.floor(dist / 18) + 4);
    const px = -dy / dist;       // perpendicular unit vector
    const py = dx / dist;
    const pts = [{ x: x1, y: y1 }];
    for (let i = 1; i < segments; i++) {
        const t = i / segments;
        const taper = Math.sin(t * Math.PI);   // 0 at ends, 1 in the middle
        const off = (Math.random() * 2 - 1) * jitter * taper;
        pts.push({ x: x1 + dx * t + px * off, y: y1 + dy * t + py * off });
    }
    pts.push({ x: x2, y: y2 });
    return pts;
}


// ============================================================
// AssetLoader
// ============================================================

class AssetLoader {
    constructor() { this.images = {}; }

    async load() {
        const tasks = [
            this._loadImage('pandaLeft', ASSETS.pandaLeft),
            this._loadImage('pandaLeftJetpack', ASSETS.pandaLeftJetpack),
            this._loadImage('pandaArmRaygun', ASSETS.pandaArmRaygun),
            this._loadImage('pandaArmM16',    ASSETS.pandaArmM16),
            this._loadImage('pandaArmVectorSmg', ASSETS.pandaArmVectorSmg),
            this._loadImage('pandaArmBazooka', ASSETS.pandaArmBazooka),
            this._loadImage('pandaArmMinigun', ASSETS.pandaArmMinigun),
            this._loadImage('bazookaRocket',   ASSETS.bazookaRocket),
            ...ASSETS.clouds.map((p, i) => this._loadImage(`cloud${i}`, p)),
            ...ASSETS.darkClouds.map((p, i) => this._loadImage(`darkCloud${i}`, p)),
            this._loadImage('bullet', ASSETS.bullet),
            this._loadImage('bulletKingBill', ASSETS.bulletKingBill),
            this._loadImage('bulletMissile', ASSETS.bulletMissile),
            this._loadImage('birdFacingRight', ASSETS.birdFacingRight),
            this._loadImage('jetpack', ASSETS.jetpack),
            this._loadImage('coin', ASSETS.coin)
        ];
        await Promise.all(tasks);
        this.cloudImages = ASSETS.clouds.map((_, i) => this.images[`cloud${i}`]);
        this.darkCloudImages = ASSETS.darkClouds.map((_, i) => this.images[`darkCloud${i}`]);
        this.bulletImage = this.images.bullet;
        this.kingBillImage = this.images.bulletKingBill;
        this.missileImage = this.images.bulletMissile;
        this.birdImage = this.images.birdFacingRight;
        this.jetpackImage = this.images.jetpack;
        this.coinImage = this.images.coin;
        this.pandaLeftJetpackImage = this.images.pandaLeftJetpack;
        this.pandaArmRaygunImage = this.images.pandaArmRaygun;
        this.pandaArmM16Image    = this.images.pandaArmM16;
        this.pandaArmVectorSmgImage = this.images.pandaArmVectorSmg;
        this.pandaArmBazookaImage   = this.images.pandaArmBazooka;
        this.pandaArmMinigunImage   = this.images.pandaArmMinigun;
        this.bazookaRocketImage     = this.images.bazookaRocket;
    }

    _loadImage(key, src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => { this.images[key] = img; resolve(); };
            img.onerror = () => reject(new Error('Failed to load ' + src));
            img.src = src;
        });
    }
}


// ============================================================
// AudioPool — round-robin HTMLAudioElement pool for overlapping plays
// ============================================================

// Global master volume (0..1), wired to the settings slider. Every
// AudioPool.play() multiplies the caller's per-shot volume by this
// scalar, so a single knob scales all SFX simultaneously without each
// call site knowing about it.
let AUDIO_MASTER_VOLUME = 1.0;
function setMasterVolume(v) {
    AUDIO_MASTER_VOLUME = clamp(v, 0, 1);
}

class AudioPool {
    // `src` may be a single path OR an array of paths (variants). With
    // multiple variants, play() rolls a random variant each call.
    // `noRepeat` (default true) guarantees the same clip never plays
    // twice in a row — good for per-shot fire SFX so the gun sounds
    // varied. Pass `noRepeat: false` for pools where back-to-back
    // repeats are fine (e.g. explosions, where a coin-flip between two
    // clips feels natural).
    // Round-robin within each variant's subpool keeps overlapping plays
    // from cutting each other off.
    constructor(src, poolSize = 6, noRepeat = true) {
        const sources = Array.isArray(src) ? src : [src];
        this.variants = sources.map(s => {
            const pool = [];
            for (let i = 0; i < poolSize; i++) {
                const a = new Audio(s);
                a.preload = 'auto';
                pool.push(a);
            }
            return { pool, idx: 0 };
        });
        this.noRepeat = noRepeat;
        this.lastVariant = -1;
    }

    play(volume = 1) {
        let vi = 0;
        if (this.variants.length > 1) {
            if (this.noRepeat) {
                do {
                    vi = Math.floor(Math.random() * this.variants.length);
                } while (vi === this.lastVariant);
            } else {
                vi = Math.floor(Math.random() * this.variants.length);
            }
            this.lastVariant = vi;
        }
        const v = this.variants[vi];
        const a = v.pool[v.idx];
        v.idx = (v.idx + 1) % v.pool.length;
        try {
            a.volume = clamp(volume * AUDIO_MASTER_VOLUME, 0, 1);
            a.currentTime = 0;
            const p = a.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) { /* audio disabled / autoplay blocked — silently ignore */ }
        // Return the Audio element so callers that need to stop/pause the
        // clip (e.g. sustained weapon-fire loops) can keep a handle. Most
        // one-shot callers just ignore the return value.
        return a;
    }
}


// ============================================================
// MusicPlayer — single looped HTMLAudio backing background music.
// ============================================================
// Driven by three independent inputs: `enabled` (Music toggle in Settings),
// `muted` (shared with the global mute button — muting sound kills music
// too), and `volume` (Music Volume slider). Effective playback volume is
// `volume` only when both enabled and not muted; otherwise the element is
// paused so it doesn't eat CPU in a silent tab.
//
// Tracks come from the MUSIC_TRACKS registry so a future track-picker can
// switch between entries without any player-code changes.
class MusicPlayer {
    constructor(tracks) {
        this.tracks = tracks;
        this.audio = null;
        this.currentKey = null;
        this.volume = 0.5;
        this.enabled = true;
        this.muted = false;
        this.pageHidden = false;    // true while the tab is backgrounded
        this.pendingPlay = false;   // set when autoplay was blocked; drained by unlock()
    }

    setTrack(key) {
        const track = this.tracks.find(t => t.key === key);
        if (!track) return;
        if (this.currentKey === key && this.audio) {
            this._refresh();
            return;
        }
        if (this.audio) {
            try { this.audio.pause(); } catch (e) { /* ignore */ }
        }
        this.currentKey = key;
        const a = new Audio();
        a.loop = true;
        a.preload = 'auto';
        a.src = track.src;
        a.volume = this._effectiveVolume();
        // Explicit load() kick-starts the fetch immediately instead of
        // waiting for the first play() call — combined with the <link
        // rel="preload"> in index.html the mp3 is almost always in memory
        // by the time autoplay is unblocked.
        try { a.load(); } catch (e) { /* ignore */ }
        // As soon as the browser has buffered enough to start playback,
        // try to play. Handles the case where unlock() fired before the
        // audio was ready — without this the loop would sit paused until
        // the next user interaction.
        a.addEventListener('canplay', () => {
            if (this._shouldPlay() && this.audio === a && a.paused) this._tryPlay();
        });
        this.audio = a;
        this._refresh();
    }

    setVolume(v) {
        this.volume = clamp(v, 0, 1);
        if (this.audio) this.audio.volume = this._effectiveVolume();
    }

    setEnabled(en)    { this.enabled    = !!en; this._refresh(); }
    setMuted(m)       { this.muted      = !!m;  this._refresh(); }
    setPageHidden(h)  { this.pageHidden = !!h;  this._refresh(); }

    // Call once on the first user interaction. Browsers block autoplay until
    // the user has interacted with the page; we retry playback here so the
    // loop starts as soon as they click anything.
    unlock() {
        if (!this.audio) return;
        if (!this._shouldPlay()) return;
        if (this.audio.paused) this._tryPlay();
        this.pendingPlay = false;
    }

    _shouldPlay() { return this.enabled && !this.muted && !this.pageHidden; }

    _effectiveVolume() {
        return this._shouldPlay() ? clamp(this.volume, 0, 1) : 0;
    }

    _tryPlay() {
        if (!this.audio) return;
        try {
            const p = this.audio.play();
            if (p && typeof p.catch === 'function') {
                p.catch(() => { this.pendingPlay = true; });
            }
        } catch (e) { this.pendingPlay = true; }
    }

    _refresh() {
        if (!this.audio) return;
        this.audio.volume = this._effectiveVolume();
        if (this._shouldPlay()) {
            if (this.audio.paused) this._tryPlay();
        } else {
            if (!this.audio.paused) {
                try { this.audio.pause(); } catch (e) { /* ignore */ }
            }
        }
    }
}


// ============================================================
// InputManager — mouse + touch + keyboard
// ============================================================

class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        this.targetX = null;
        this.keyLeft = false;
        this.keyRight = false;
        this.keyJetpack = false;   // F held → jetpack thrust while equipped
        // 'pointer' = mouse/touch drives movement, 'keyboard' = A/D drives it.
        // Sticky: only flips when the *other* source is used so releasing A/D
        // doesn't snap the panda back to a stale cursor position.
        this.mode = 'pointer';
        // Latched left-click fire request — WeaponSystem consumes it once
        // the cooldown allows. Clicks during cooldown buffer ONE shot.
        this.fireRequested = false;
        // True while the left mouse button is currently held down. Used by
        // auto-fire weapons to detect intentional holds.
        this.mousePressed = false;
        // performance.now() of the most recent mousedown. Auto-fire weapons
        // use `now - mouseDownAt` to distinguish a soft click from a hold.
        this.mouseDownAt = 0;

        // Pointer activity only flips back to pointer mode when no A/D is
        // currently held — keyboard wins if both are active.
        const activatePointer = () => {
            if (!this.keyLeft && !this.keyRight) this.mode = 'pointer';
        };

        canvas.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;       // left click only
            this.fireRequested = true;
            this.mousePressed = true;
            this.mouseDownAt = performance.now();
        });
        // Listen on window so a release outside the canvas still clears the
        // pressed state (the user can't otherwise un-stick the auto-fire).
        window.addEventListener('mouseup', (e) => {
            if (e.button !== 0) return;
            this.mousePressed = false;
        });
        window.addEventListener('blur', () => { this.mousePressed = false; });

        // Input reads CSS pixels from DOM events but `targetX` must live in
        // LOGICAL (world) coords so the player's x comparison works. Dividing
        // by WORLD_ZOOM does the conversion (zoom=1 is a no-op).
        canvas.addEventListener('mousemove', (e) => {
            if (document.pointerLockElement === canvas) {
                // Pointer is locked — OS cursor is captured. Use the delta and
                // clamp to the logical viewport so movement past the visible
                // edge doesn't walk off into negative world space.
                const logicalW = canvas.clientWidth / WORLD_ZOOM;
                if (this.targetX == null) this.targetX = logicalW / 2;
                this.targetX = clamp(this.targetX + (e.movementX || 0) / WORLD_ZOOM, 0, logicalW);
            } else {
                const rect = canvas.getBoundingClientRect();
                this.targetX = (e.clientX - rect.left) / WORLD_ZOOM;
            }
            activatePointer();
        });
        // mouseleave: hold last targetX (no reset)
        canvas.addEventListener('touchstart', (e) => {
            if (e.touches.length > 0) {
                const rect = canvas.getBoundingClientRect();
                this.targetX = (e.touches[0].clientX - rect.left) / WORLD_ZOOM;
            }
            activatePointer();
        }, { passive: true });
        canvas.addEventListener('touchmove', (e) => {
            if (e.touches.length > 0) {
                const rect = canvas.getBoundingClientRect();
                this.targetX = (e.touches[0].clientX - rect.left) / WORLD_ZOOM;
            }
            activatePointer();
            e.preventDefault();
        }, { passive: false });

        const onKey = (down) => (e) => {
            if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
                this.keyLeft = down;
                if (down) this.mode = 'keyboard';
            } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
                this.keyRight = down;
                if (down) this.mode = 'keyboard';
            } else if (e.key === 'f' || e.key === 'F') {
                this.keyJetpack = down;
            } else return;
            e.preventDefault();
        };
        window.addEventListener('keydown', onKey(true));
        window.addEventListener('keyup', onKey(false));
    }

    reset() {
        this.targetX = null;
        this.mode = 'pointer';
        this.fireRequested = false;
        this.mousePressed = false;
        this.mouseDownAt = 0;
    }
    get keyDir() { return (this.keyRight ? 1 : 0) - (this.keyLeft ? 1 : 0); }
}


// ============================================================
// Player — panda with auto-jump physics, wrap, sprite flip
// ============================================================

class Player {
    constructor(spriteLeft, spriteJetpack) {
        this.spriteLeft = spriteLeft;
        this.spriteJetpack = spriteJetpack;
        this.aspect = spriteLeft.naturalWidth / spriteLeft.naturalHeight;
        this.setHeight(PLAYER_BASE_HEIGHT);
        this.x = 0; this.y = 0;
        this.vx = 0; this.vy = 0;
        this.facing = 'right';
        this.prevFeetY = 0;
        this.canDoubleJump = false;
        this.doubleJumpReadyAt = 0;
        // Jetpack state
        this.jetpackActive = false;
        this.jetpackFuel = 0;                   // 0..1
        this.jetpackAutoThrustRemaining = 0;    // fraction of fuel left in the auto-thrust grace window
        this._jetpackThrustingThisFrame = false;
        this.stretchUntil = 0;   // stretch-animation window — only set by landings + double jumps
        // Weapon + arm overlay. Set via equipWeapon(); cleared via unequipWeapon().
        this.armEquipped = false;
        this.weapon = null;
        this.armSprite = null;
        // Aim state. WeaponSystem sets `armAngleTarget` each frame (radians,
        // positive = up); `armAngleCurrent` lerps toward it for a quick swing.
        this.armAngleCurrent = 0;
        this.armAngleTarget = 0;
    }

    setAimAngle(angleRad) { this.armAngleTarget = angleRad; }

    tickArmAim(step) {
        if (!this.weapon) return;
        const f = easeStep(ARM_AIM_LERP, step);
        this.armAngleCurrent += (this.armAngleTarget - this.armAngleCurrent) * f;
    }

    equipWeapon(weaponConfig, armSprite) {
        this.weapon = weaponConfig;
        this.armSprite = armSprite;
        this.armEquipped = true;
    }

    unequipWeapon() {
        this.weapon = null;
        this.armSprite = null;
        this.armEquipped = false;
    }

    setHeight(h) {
        this.height = h;
        this.width = h * this.aspect;
    }

    reset(x, y) {
        this.x = x; this.y = y;
        this.vx = 0; this.vy = 0;
        this.prevFeetY = y + this.height;
        this.facing = 'right';
        this.canDoubleJump = false;
        this.doubleJumpReadyAt = 0;
        this.jetpackActive = false;
        this.jetpackFuel = 0;
        this.jetpackAutoThrustRemaining = 0;
        this._jetpackThrustingThisFrame = false;
        this.stretchUntil = 0;
        this.armAngleCurrent = 0;
        this.armAngleTarget = 0;
    }

    get feetY() { return this.y + this.height; }

    update(step, input, viewportW) {
        // Horizontal target: driven by whichever input source is currently
        // active. Mode is sticky so releasing A/D doesn't snap the panda
        // back to a stale cursor position; moving the mouse (with no A/D
        // held) flips back to pointer control.
        let target;
        if (input.mode === 'keyboard') {
            target = this.x + input.keyDir * viewportW;
        } else {
            target = input.targetX;
        }
        if (target == null) target = this.x;

        const prevX = this.x;
        // Sensitivity scales both knobs together — alpha controls how fast
        // the panda approaches the target, maxStep caps the absolute per-
        // frame jump. 1.0 matches the original tuning.
        let dx = (target - this.x) * easeStep(PHYSICS.horizontalEaseAlpha * SENSITIVITY, step);
        const maxDx = PHYSICS.horizontalMaxStep * SENSITIVITY * step;
        dx = clamp(dx, -maxDx, maxDx);
        this.x += dx;
        this.vx = (this.x - prevX) / Math.max(step, 0.0001);

        if (Math.abs(this.vx) > PHYSICS.facingDeadzone) {
            this.facing = this.vx > 0 ? 'right' : 'left';
        }

        // Clamp to the viewport. (Pointer lock already keeps the mouse inside
        // the canvas, so wrap-around is no longer needed — and the ghost
        // sprite it used to draw at the opposite edge looked like a bug.)
        const halfW = this.width / 2;
        this.x = clamp(this.x, halfW, viewportW - halfW);

        // Vertical (record prevFeetY before moving for swept collision)
        this.prevFeetY = this.feetY;
        this.vy = Math.min(this.vy + PHYSICS.gravity * step, PHYSICS.terminalVelocity);
        this.y += this.vy * step;
    }

    landOn(cloud) {
        this.y = cloud.hitboxTop - this.height;
        this.vy = PHYSICS.jumpVelocity * cloud.springMult;
        this.grantDoubleJump();
        this.stretchUntil = performance.now() + 360;   // kicks off the jump squish
    }

    // Unified recharge: sets the flag AND starts the lockout timer so the
    // player can't press Space the same frame they touch the cloud/bullet/bird.
    grantDoubleJump() {
        this.canDoubleJump = true;
        this.doubleJumpReadyAt = performance.now() + DOUBLE_JUMP_LOCKOUT_MS;
    }

    tryDoubleJump(allowed = true) {
        if (!allowed) return false;
        if (!this.canDoubleJump) return false;
        if (performance.now() < this.doubleJumpReadyAt) return false;
        this.canDoubleJump = false;
        this.vy = PHYSICS.jumpVelocity * DOUBLE_JUMP_MULT;
        this.stretchUntil = performance.now() + 320;
        return true;
    }

    // --- Jetpack pickup / flight ---
    equipJetpack() {
        this.jetpackActive = true;
        this.jetpackFuel = 1;
        // Auto-thrust grace window — the first 20% of fuel burns WITHOUT
        // requiring F, so a mid-fall pickup doesn't punish slow reflexes.
        this.jetpackAutoThrustRemaining = 0.20;
        // Instant upward kick: cancel any fall, snap vy to the thrust cap so
        // the boost is immediately visible.
        if (this.vy > JETPACK_MAX_UP_VY) this.vy = JETPACK_MAX_UP_VY;
    }
    removeJetpack() {
        this.jetpackActive = false;
        this.jetpackFuel = 0;
        this.jetpackAutoThrustRemaining = 0;
        this._jetpackThrustingThisFrame = false;
    }
    // Apply thrust + drain fuel. Returns true the frame fuel hits zero so
    // Game can kick the next-spawn timer from that exact moment.
    tickJetpack(step, fHeld) {
        if (!this.jetpackActive) { this._jetpackThrustingThisFrame = false; return false; }
        const dt = step / 60;
        const fuelOk = this.jetpackFuel > 0;
        const autoThrusting = fuelOk && this.jetpackAutoThrustRemaining > 0;
        const userThrusting = fuelOk && fHeld;
        const thrusting = autoThrusting || userThrusting;
        this._jetpackThrustingThisFrame = thrusting;
        if (thrusting) {
            this.vy = Math.max(this.vy - JETPACK_THRUST_ACCEL * step, JETPACK_MAX_UP_VY);
        }
        const rate = thrusting ? (1 / JETPACK_BURN_SECONDS) : (1 / JETPACK_IDLE_SECONDS);
        const drained = rate * dt;
        this.jetpackFuel = Math.max(0, this.jetpackFuel - drained);
        if (autoThrusting) {
            this.jetpackAutoThrustRemaining = Math.max(0, this.jetpackAutoThrustRemaining - drained);
        }
        if (this.jetpackFuel <= 0) { this.removeJetpack(); return true; }
        return false;
    }
    // Exhaust emit point in world coords. When facing left the jetpack is on
    // the panda's back (right side of sprite); when facing right, mirrored.
    getJetpackExhaustPos() {
        const side = this.facing === 'left' ? 1 : -1;
        return {
            x: this.x + side * this.width * JETPACK_EXHAUST_X_FRAC,
            y: this.y + this.height * JETPACK_EXHAUST_Y_FRAC
        };
    }

    isFallenOff(cameraY, viewportH) {
        return this.y > cameraY + viewportH;
    }

    render(ctx, cameraY, viewportW) {
        const screenY = this.y - cameraY;
        const sprite = this.jetpackActive ? this.spriteJetpack : this.spriteLeft;
        // Arm draws BEFORE the body so the panda visually covers the shoulder.
        this._drawArm(ctx, this.x, screenY);
        this._drawAt(ctx, sprite, this.x, screenY);
    }

    // Smart-aim angle. Positive = aim UP, negative = aim DOWN; same convention
    // for both facings (the per-facing flip is applied in _drawArm / barrel calc).
    _currentArmAngle() {
        if (!this.weapon) return 0;
        return this.armAngleCurrent;
    }

    // Bundle: pivot screen-X, pivot screen-Y, flip, angleRad, arm dims, image
    // pivot offsets. Used by both _drawArm (for canvas transforms) and
    // getBarrelPosAndAim (for projectile spawn location).
    _armRig(cx, screenY) {
        const w = this.weapon;
        const facingLeft = this.facing === 'left';
        const flip = facingLeft ? 1 : -1;
        const halfW = this.width / 2;
        const angleRad = this._currentArmAngle();
        // Normalize rotation against its own up/down limit so both extremes
        // hit exactly 1.0 — symmetric tuck even though limits aren't equal.
        const angleDeg = angleRad * 180 / Math.PI;
        const extremeNorm = angleDeg >= 0
            ? Math.min(1,  angleDeg / w.angleUpDeg)
            : Math.min(1, -angleDeg / w.angleDownDeg);
        const tuck = w.pivotTuckAtLimitFrac * extremeNorm * this.width;
        const pivotX = facingLeft
            ? cx - halfW + w.armPivotXFrac * this.width + tuck
            : cx + halfW - w.armPivotXFrac * this.width - tuck;
        const pivotY = screenY + w.armPivotYFrac * this.height;
        const aspect = this.armSprite.naturalWidth / this.armSprite.naturalHeight;
        const armW = this.width * w.armWidthFrac;
        const armH = armW / aspect;
        const imgPivotX = w.imgPivotXFrac * armW;
        const imgPivotY = w.imgPivotYFrac * armH;
        return { pivotX, pivotY, flip, angleRad, armW, armH, imgPivotX, imgPivotY };
    }

    _drawArm(ctx, cx, screenY) {
        if (!this.armEquipped || !this.armSprite || !this.weapon) return;
        const r = this._armRig(cx, screenY);
        // ctx.scale(flip,1) then ctx.rotate(angle) gives screen = Scale·Rotate·p.
        // The arm image points LEFT at angle 0; rotating by +angle (math CCW,
        // visual CCW too because Y is down) swings the gun UPWARD. After
        // mirroring, the same +angle still swings the gun upward in screen
        // space — no per-facing sign flip needed.
        ctx.save();
        ctx.translate(r.pivotX, r.pivotY);
        ctx.scale(r.flip, 1);
        ctx.rotate(r.angleRad);
        ctx.drawImage(this.armSprite, -r.imgPivotX, -r.imgPivotY, r.armW, r.armH);
        ctx.restore();
    }

    // World-space barrel position + unit aim direction, computed using the
    // SAME transform stack as _drawArm so a projectile spawns exactly where
    // the gun is visibly drawn. Returns null if no weapon equipped.
    // `offsetOverride` (optional) = { xFrac, yFrac } — replaces the weapon's
    // default barrel point for this call. Used by multi-barrel weapons to
    // query each muzzle position in turn with the same transform stack.
    getBarrelPosAndAim(cameraY, offsetOverride = null) {
        if (!this.armEquipped || !this.armSprite || !this.weapon) return null;
        const w = this.weapon;
        const screenY = this.y - cameraY;
        const r = this._armRig(this.x, screenY);
        const bxFrac = offsetOverride ? offsetOverride.xFrac : w.barrelImgXFrac;
        const byFrac = offsetOverride ? offsetOverride.yFrac : w.barrelImgYFrac;
        // Barrel offset relative to the IMAGE pivot, in image-local coords.
        const blx = (bxFrac * r.armW) - r.imgPivotX;
        const bly = (byFrac * r.armH) - r.imgPivotY;
        const cosA = Math.cos(r.angleRad), sinA = Math.sin(r.angleRad);
        // rotate(angle) THEN scale(flip, 1)
        const rx = blx * cosA - bly * sinA;
        const ry = blx * sinA + bly * cosA;
        const barrelScreenX = r.pivotX + r.flip * rx;
        const barrelScreenY = r.pivotY + ry;
        // Gun in image-local space points -X. After rotate then scale(flip,1):
        //   aim = (-flip*cosA, -sinA)
        const aimX = -r.flip * cosA;
        const aimY = -sinA;
        // Viewport doesn't pan horizontally → screen X = world X. Convert Y.
        return {
            x:  barrelScreenX,
            y:  barrelScreenY + cameraY,
            dx: aimX,
            dy: aimY
        };
    }

    _drawAt(ctx, sprite, cx, screenY) {
        // Jump squish is tied to the *impulse* of a cloud landing or double
        // jump (a short window opened by those events), not to raw vy. Jetpack
        // thrust never opens that window, so flying — and the fall-out right
        // after releasing F — both stay at neutral proportions.
        const inJumpWindow = performance.now() < this.stretchUntil;
        const stretch = inJumpWindow ? clamp(-this.vy / 30, -0.06, 0.10) : 0;
        const sx = 1 - stretch * 0.4;
        const sy = 1 + stretch;
        // Sprite asset faces left; mirror horizontally when facing right.
        const flip = this.facing === 'right' ? -1 : 1;
        ctx.save();
        ctx.translate(cx, screenY + this.height / 2);
        ctx.scale(sx * flip, sy);
        ctx.drawImage(sprite, -this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }
}


// ============================================================
// Cloud — one platform
// ============================================================

class Cloud {
    constructor(x, y, width, image) {
        this.x = x; this.y = y;
        this.width = width;
        this.image = image;
        this.aspect = image.naturalWidth / image.naturalHeight;
        this.height = width / this.aspect;
        this.used = false;
        this.vanishT = 0;
        this.isHazard = false;
        // Per-cloud bounce strength. Most are normal; sometimes a cloud fires
        // you way higher than its neighbors.
        this.springMult = Cloud._rollSpring();
        // Motion fields (base-class so any cloud type can drift horizontally).
        // Turned on via CloudManager._makeMoving for the subset that drift.
        this.moves = false;
        this.vx = 0;
        this.minX = 0;
        this.maxX = 0;
        this._rowNeighbors = [];
    }

    static _rollSpring() {
        const r = Math.random();
        // Super bounce — excess above 1.0 cut by 30% vs the original
        // 1.45-1.70 range to keep the panda from launching into a storm
        // cloud before it has time to steer.
        if (r < 0.08) return 1.315 + Math.random() * 0.175; // rare super bounce (~1.315-1.49)
        if (r < 0.25) return 1.15  + Math.random() * 0.20;  // occasional nice boost (~1.15-1.35)
        return 0.95 + Math.random() * 0.10;                 // normal (~0.95-1.05)
    }

    get left() { return this.x - this.width / 2; }
    get right() { return this.x + this.width / 2; }
    // hitbox is a 1-px line at this y; swept collision handles thickness
    get hitboxTop() { return this.y + this.height * CLOUD_HITBOX_DEPTH; }

    update(step) {
        if (this.used && this.vanishT < 1) {
            this.vanishT = Math.min(1, this.vanishT + step / CLOUD_VANISH_FRAMES);
        }
        if (this.moves && !this.used) this._updateMotion(step);
    }

    // Horizontal drift with edge + neighbor bounce. Generic enough to apply to
    // any Cloud subtype — StormCloud picks this up for free via super.update().
    _updateMotion(step) {
        let nextX = this.x + this.vx * (step / 60);  // step normalized to 60fps frames

        if (nextX < this.minX) { nextX = this.minX; this.vx = -this.vx; }
        else if (nextX > this.maxX) { nextX = this.maxX; this.vx = -this.vx; }

        for (const c of this._rowNeighbors) {
            const buffer = (this.width + c.width) / 2 + 30;
            if (Math.abs(nextX - c.x) < buffer) {
                nextX = this.vx > 0 ? c.x - buffer : c.x + buffer;
                this.vx = -this.vx;
                break;
            }
        }

        this.x = nextX;
    }

    isGone() { return this.used && this.vanishT >= 1; }

    render(ctx, cameraY, viewportH) {
        const screenY = this.y - cameraY;
        if (screenY < -this.height - 20 || screenY > viewportH + 20) return;
        ctx.save();
        if (this.used) {
            const t = this.vanishT;
            const scale = 1 - t * 0.6;
            ctx.globalAlpha = 1 - t;
            ctx.translate(this.x, screenY + this.height / 2);
            ctx.scale(scale, scale);
            ctx.drawImage(this.image, -this.width / 2, -this.height / 2, this.width, this.height);
        } else {
            ctx.drawImage(this.image, this.left, screenY, this.width, this.height);
        }
        ctx.restore();
    }
}


// ============================================================
// StormCloud — hazard variant that crackles with live lightning.
// Same shape & collision as Cloud, but landing kills the panda.
// ============================================================

class StormCloud extends Cloud {
    constructor(x, y, width, image) {
        super(x, y, width, image);
        this.isHazard = true;
        this.bolts = [];
        const now = performance.now();
        // Per-cloud phase offset so storms don't crackle in unison.
        const seed = Math.random() * 400;
        this.nextSparkAt = now + seed * 0.4;
        this.nextBoltAt = now + 200 + seed * 1.5;
    }

    update(step) {
        super.update(step);
        const now = performance.now();
        // Cull expired bolts
        this.bolts = this.bolts.filter(b => now - b.bornAt < b.maxLife);
        // Schedule new sparks/bolts on wall clock so cadence is steady regardless of dt.
        let safety = 8;
        while (now >= this.nextSparkAt && safety-- > 0) {
            this._spawnSpark(now);
            this.nextSparkAt = now + 80 + Math.random() * 130;
        }
        safety = 4;
        while (now >= this.nextBoltAt && safety-- > 0) {
            this._spawnBolt(now);
            this.nextBoltAt = now + 500 + Math.random() * 800;
        }
    }

    _spawnSpark(now) {
        const top = this.y + this.height * 0.05;
        const bot = this.y + this.height * 0.65;
        const x1 = this.x + (Math.random() - 0.5) * this.width * 0.85;
        const y1 = lerp(top, bot, Math.random());
        const len = 8 + Math.random() * 14;
        const ang = Math.random() * Math.PI * 2;
        const x2 = x1 + Math.cos(ang) * len;
        const y2 = y1 + Math.sin(ang) * len;
        this.bolts.push({
            pts: makeBolt(x1, y1, x2, y2, 2.5),
            bornAt: now,
            maxLife: 60 + Math.random() * 70,
            big: false
        });
    }

    _spawnBolt(now) {
        const cx = this.x;
        const cy = this.y + this.height * 0.42;
        const ang1 = Math.random() * Math.PI * 2;
        const r1 = this.width * 0.30 + Math.random() * this.width * 0.18;
        const r2 = this.width * 0.30 + Math.random() * this.width * 0.18;
        const x1 = cx + Math.cos(ang1) * r1;
        const y1 = cy + Math.sin(ang1) * (this.height * 0.30);
        const ang2 = ang1 + Math.PI + (Math.random() - 0.5) * 0.6;
        const x2 = cx + Math.cos(ang2) * r2;
        const y2 = cy + Math.sin(ang2) * (this.height * 0.30);
        const main = {
            pts: makeBolt(x1, y1, x2, y2, 8),
            bornAt: now,
            maxLife: 130 + Math.random() * 70,
            big: true
        };
        this.bolts.push(main);
        // 30% chance of a forked side-bolt
        if (Math.random() < 0.30) {
            const mid = main.pts[Math.floor(main.pts.length / 2)];
            const baseAng = Math.atan2(y2 - y1, x2 - x1);
            const forkAng = baseAng + (Math.random() < 0.5 ? -1 : 1) * (0.5 + Math.random() * 0.5);
            const forkLen = 14 + Math.random() * 18;
            const fx = mid.x + Math.cos(forkAng) * forkLen;
            const fy = mid.y + Math.sin(forkAng) * forkLen;
            this.bolts.push({
                pts: makeBolt(mid.x, mid.y, fx, fy, 3.5),
                bornAt: now,
                maxLife: 80 + Math.random() * 50,
                big: false
            });
        }
    }

    render(ctx, cameraY, viewportH, nightFactor = 0) {
        const screenY = this.y - cameraY;
        const onScreen = !(screenY < -this.height - 20 || screenY > viewportH + 20);

        // Pulsing "charged" halo — rendered BEFORE the cloud sprite so it
        // reads as an aura bleeding out from behind the cloud. Opacity is
        // driven by nightFactor so the effect only appears at night (when
        // the storm sprite is hardest to pick out against the dark sky).
        // Two stacked radial gradients: a wider cool-blue base + a tighter
        // violet core. Pulse period is slow (~1.8s) and per-cloud phase
        // offset keeps adjacent storms out of sync.
        if (onScreen && nightFactor > 0.01) {
            const now = performance.now();
            const pulse = 0.55 + 0.45 * Math.sin(now * 0.0035 + this.x * 0.017);
            const cx = this.x;
            const cy = screenY + this.height * 0.5;
            const rOuter = this.width * 0.95;
            const rInner = this.width * 0.55;
            ctx.save();
            ctx.globalCompositeOperation = 'lighter';
            // Outer cool-blue halo
            const outerAlpha = 0.28 * nightFactor * pulse;
            const gOuter = ctx.createRadialGradient(cx, cy, rInner * 0.5, cx, cy, rOuter);
            gOuter.addColorStop(0.0, `rgba(130, 190, 255, ${outerAlpha.toFixed(3)})`);
            gOuter.addColorStop(0.6, `rgba(90, 120, 220, ${(outerAlpha * 0.5).toFixed(3)})`);
            gOuter.addColorStop(1.0, 'rgba(60, 40, 120, 0)');
            ctx.fillStyle = gOuter;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rOuter, this.height * 0.95, 0, 0, Math.PI * 2);
            ctx.fill();
            // Inner violet core — smaller, brighter peak of the pulse
            const innerAlpha = 0.35 * nightFactor * pulse;
            const gInner = ctx.createRadialGradient(cx, cy, 0, cx, cy, rInner);
            gInner.addColorStop(0.0, `rgba(200, 170, 255, ${innerAlpha.toFixed(3)})`);
            gInner.addColorStop(1.0, 'rgba(120, 80, 220, 0)');
            ctx.fillStyle = gInner;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rInner, this.height * 0.65, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }

        super.render(ctx, cameraY, viewportH);
        if (!onScreen) return;

        const now = performance.now();
        for (const b of this.bolts) {
            const age = now - b.bornAt;
            if (age >= b.maxLife) continue;
            const t = age / b.maxLife;
            const alpha = 1 - t;

            // Brief peak-flash glow on big bolts
            if (b.big && age < 40) {
                const flashT = 1 - age / 40;
                ctx.save();
                ctx.globalCompositeOperation = 'lighter';
                ctx.globalAlpha = 0.18 * flashT;
                ctx.fillStyle = '#a8d8ff';
                ctx.beginPath();
                ctx.ellipse(this.x, this.y + this.height * 0.5 - cameraY,
                    this.width * 0.5, this.height * 0.55, 0, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }

            ctx.save();
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            // Outer halo
            ctx.beginPath();
            ctx.moveTo(b.pts[0].x, b.pts[0].y - cameraY);
            for (let i = 1; i < b.pts.length; i++) {
                ctx.lineTo(b.pts[i].x, b.pts[i].y - cameraY);
            }
            ctx.strokeStyle = `rgba(140, 200, 255, ${(alpha * 0.45).toFixed(3)})`;
            ctx.lineWidth = b.big ? 8 : 4;
            ctx.stroke();
            // Inner bright core
            ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
            ctx.lineWidth = b.big ? 2.5 : 1.5;
            ctx.stroke();
            ctx.restore();
        }
    }
}


// ============================================================
// Bullet + BulletManager — homing projectile hazard.
// Sprite faces left in source; rotated/mirrored at draw time so
// the head always points along the velocity vector.
// ============================================================

const BULLET_BASE_WIDTH = 70;
const BULLET_TURN_RATE = 1.6;        // rad/sec — gentle enough to dodge
// Missiles are the "scary" variant of the same Bullet class: same size,
// same hit rules, but a sharper turn rate so they lead the panda more
// aggressively and feel like a homing missile rather than a dumb shell.
// Used in Bullet.update via the kind === 'missile' branch.
const MISSILE_TURN_RATE = 3.0;       // rad/sec — ~2× the normal bullet
// If the panda is within this fraction of the viewport to a side edge, we
// DO NOT spawn bullets / missiles / KingBills from that side — the panda
// has no room to dodge that way, so it would read as an instant-kill. The
// rule applies equally to the normal top-left / top-right diagonals.
const BULLET_NEAR_EDGE_FRAC = 0.25;
const KING_BILL_BASE_WIDTH = 140;    // King Bill: ≈2× normal bullet width

// Missile = red angry variant of the normal bullet. Same size, same homing,
// same smoke trail — just faster, rarer, never stompable, capped at 2 alive.
const MISSILE_SPEED_MULT   = 1.20;   // ~20% faster than the normal-bullet speed curve
const MISSILE_MAX_SPEED    = 460;    // absolute px/sec cap — keeps missile dodgeable
                                     // even at high altitude on Hard, where the
                                     // normal bullet curve alone hits 600 px/sec
const MISSILE_MIN_ALTITUDE = 4500;   // first missile only after the player has climbed a bit
const MISSILE_MAX_ALIVE    = 1;      // never more than one missile alive — Hard only
                                     // increases the *odds* (missileChanceMax), not the cap
// Missiles AND KingBills have a homing lifespan — after the timeout they
// redirect onto a random distant waypoint (so they veer off the player's
// line and fly out of the arena). The projectile is considered "retired"
// after redirect: it no longer counts toward the per-kind spawn cap, so
// another one can spawn while the retired one coasts offscreen. KingBill
// and missile fuses are short; normal bullets get a much longer fuse so
// they still feel like a persistent threat before eventually peeling off.
const MISSILE_HOMING_MIN_MS = 3000;
const MISSILE_HOMING_MAX_MS = 4500;
const KINGBILL_HOMING_MIN_MS = 3000;
const KINGBILL_HOMING_MAX_MS = 4500;
const BULLET_HOMING_MIN_MS = 7000;
const BULLET_HOMING_MAX_MS = 13000;

// Per-weapon hit cost lives in WEAPONS[*].hitsToKillMissile. The bullet
// counts incoming hits via `hitCount` (incremented in WeaponSystem) and
// the kill threshold is read from the firing weapon's config.

class Bullet {
    constructor() {
        this.active = false;
        this.isBullet = true;
        this.x = 0; this.y = 0;
        this.vx = 0; this.vy = 0;
        this.angle = 0;
        this.prevY = 0;
        this.width = BULLET_BASE_WIDTH;
        this.height = 30;
        this.speed = 220;
        this.smokeTimer = 0;
        // Brief homing lockout after a bullet-vs-bullet bonk so the knock
        // reads visually before the bullet curves back at the panda.
        this.knockStunnedUntil = 0;
        // Wall-clock timestamp after which the bullet retires: it picks a
        // random distant waypoint and homes on THAT instead of the player.
        // Every projectile sets this on spawn (normals get a long fuse,
        // missile + KingBill get short ones).
        this.homingExpiresAt = Infinity;
        // Fixed {x,y} chosen once on fuse end so the trajectory stays stable
        // rather than spinning around. Null while still tracking the player.
        this.homingRandomTarget = null;
        // Subclasses override these to scale the trail (KingBill = denser + chunkier).
        this.smokeIntervalMs = 35;
        this.smokeScale = 1;
        // Variant within the same pool — 'normal' (Mario bullet bill, stompable)
        // or 'missile' (red, faster, NOT stompable). Set per-spawn so the same
        // pool slot can flip between them without realloc.
        this.kind = 'normal';
        // Cumulative shots that have hit this bullet. Incremented in
        // WeaponSystem._resolveHits. Compared against weapon.hitsToKillMissile
        // for missiles; normals/bird die in 1 hit regardless.
        this.hitCount = 0;
    }

    // Bullets are stompable from above by default. KingBill (subclass) hard-
    // disables this; missiles disable per-instance via the kind flag.
    get stompable() { return this.kind !== 'missile'; }

    spawn(x, y, targetX, targetY, speed, width, height, kind = 'normal') {
        this.active = true;
        this.x = x; this.y = y;
        this.prevY = y;
        this.width = width;
        this.height = height;
        this.speed = speed;
        this.kind = kind;
        const baseAngle = Math.atan2(targetY - y, targetX - x);
        const wobble = (Math.random() - 0.5) * (30 * Math.PI / 180);  // ±15°
        this.angle = baseAngle + wobble;
        this.vx = Math.cos(this.angle) * speed;
        this.vy = Math.sin(this.angle) * speed;
        this.smokeTimer = 0;
        this.knockStunnedUntil = 0;
        this.hitCount = 0;
        this.homingRandomTarget = null;
        // Every projectile gets a homing fuse — after expiry it picks a
        // random distant waypoint and homes on THAT, so the player can stay
        // out of the line and watch it peel toward the arena edge. Normal
        // bullets get a much longer fuse than missile/KingBill — they're
        // smaller and slower, so they can threaten the player longer before
        // retiring without feeling unfair.
        let fuseMs;
        if (this.isKingBill) {
            fuseMs = randRange(KINGBILL_HOMING_MIN_MS, KINGBILL_HOMING_MAX_MS);
        } else if (kind === 'missile') {
            fuseMs = randRange(MISSILE_HOMING_MIN_MS, MISSILE_HOMING_MAX_MS);
        } else {
            fuseMs = randRange(BULLET_HOMING_MIN_MS, BULLET_HOMING_MAX_MS);
        }
        this.homingExpiresAt = performance.now() + fuseMs;
    }

    update(step, player, particles, speedMult = 1, nightFactor = 0) {
        this.prevY = this.y;
        const now = performance.now();
        const stunned = now < this.knockStunnedUntil;
        // Fuse expiry → pick a random distant waypoint once and keep homing
        // on that point for the rest of the projectile's life. Because the
        // waypoint is far outside the viewport, the turn-rate-clamped path
        // naturally drifts off the player's line and exits the screen.
        if (now >= this.homingExpiresAt && !this.homingRandomTarget) {
            const angle = Math.random() * Math.PI * 2;
            const dist = 4000;
            this.homingRandomTarget = {
                x: this.x + Math.cos(angle) * dist,
                y: this.y + Math.sin(angle) * dist
            };
        }
        if (!stunned) {
            const target = this.homingRandomTarget
                ? this.homingRandomTarget
                : { x: player.x, y: player.y + player.height / 2 };
            // Homing — turn rate is capped so a sharp dodge is possible.
            // Missiles turn ~2× faster than normal bullets so they track
            // harder and feel distinct from the dumb Bullet Bill shells.
            const desired = Math.atan2(target.y - this.y, target.x - this.x);
            let delta = desired - this.angle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            const turnRate = this.kind === 'missile' ? MISSILE_TURN_RATE : BULLET_TURN_RATE;
            const maxTurn = turnRate * (step / 60);
            if (delta > maxTurn) delta = maxTurn;
            else if (delta < -maxTurn) delta = -maxTurn;
            this.angle += delta;
            // Live speed mult (night factor) re-applied each frame so the
            // boost scales smoothly with the day/night cycle even for
            // bullets spawned during the day.
            const spd = this.speed * speedMult;
            this.vx = Math.cos(this.angle) * spd;
            this.vy = Math.sin(this.angle) * spd;
        }
        // Stun still freezes steering; velocity carries over until it lifts.
        this.x += this.vx * (step / 60);
        this.y += this.vy * (step / 60);

        // Exhaust trail — cadence + puff size configurable per subclass.
        // Each emission spawns BOTH a fire core (short-lived, bright) and
        // a grey smoke puff (longer-lived, fades behind). The bullet moves
        // forward leaving the fire near the cannon and the smoke trailing —
        // visually reads like a rocket exhaust on every bullet variant.
        //
        // At night the trail is amped: emitted more often AND each puff is
        // bigger/brighter, so the dark sprite is easier to track against
        // the dark sky. Both factors scale with nightFactor (0..1) so the
        // ramp matches the sky transition — zero cost during the day.
        const nightIntervalScale = 1 + 0.55 * nightFactor;   // up to ~55% faster cadence
        const nightSizeScale     = 1 + 0.70 * nightFactor;   // up to ~70% bigger puffs
        this.smokeTimer += step * (1000 / 60) * nightIntervalScale;
        if (this.smokeTimer >= this.smokeIntervalMs) {
            const tailX = this.x - Math.cos(this.angle) * (this.width * 0.5);
            const tailY = this.y - Math.sin(this.angle) * (this.width * 0.5);
            const scale = this.smokeScale * nightSizeScale;
            particles.spawnBulletFlame(tailX, tailY, scale);
            particles.spawnSmokePuff(tailX, tailY, scale);
            this.smokeTimer = 0;
        }
    }

    overlaps(player) {
        const playerLeft  = player.x - player.width  / 2 + 6;
        const playerRight = player.x + player.width  / 2 - 6;
        const playerTop   = player.y;
        const playerBot   = player.y + player.height;
        const bulletLeft  = this.x - this.width  * 0.35;
        const bulletRight = this.x + this.width  * 0.35;
        const bulletTop   = this.y - this.height * 0.35;
        const bulletBot   = this.y + this.height * 0.35;
        return playerRight > bulletLeft && playerLeft < bulletRight
            && playerBot > bulletTop && playerTop < bulletBot;
    }

    // Panda center is in the front 35% of the bullet along its velocity axis.
    isHeadHit(player) {
        const ux = Math.cos(this.angle), uy = Math.sin(this.angle);
        const dx = player.x - this.x;
        const dy = (player.y + player.height / 2) - this.y;
        const proj = dx * ux + dy * uy;
        return proj > this.width * 0.15;
    }

    // Mario stomp: panda is descending AND its feet were above the bullet's
    // vertical center on the previous frame.
    isStomp(player) {
        return player.vy > 0 && player.prevFeetY <= this.y;
    }

    get hitboxTop() { return this.y - this.height / 2; }

    // True once the homing fuse has handed the projectile off to a random
    // waypoint. Used by spawn caps (doesn't count against the cap) and by
    // the auto-aim picker (skipped as a target since it's no longer a threat).
    isRetired() { return this.homingRandomTarget !== null; }

    isOffscreen(viewport, cameraY) {
        const m = 200;
        return this.x < -m
            || this.x > viewport.w + m
            || this.y < cameraY - m
            || this.y > cameraY + viewport.h + m;
    }

    render(ctx, cameraY, image) {
        const screenY = this.y - cameraY;
        ctx.save();
        ctx.translate(this.x, screenY);
        if (Math.cos(this.angle) > 0) {
            // Velocity points right → mirror, then rotate by -angle.
            ctx.scale(-1, 1);
            ctx.rotate(-this.angle);
        } else {
            // Velocity points left → no mirror; rotate so the (left-facing) head
            // ends up along the velocity vector.
            ctx.rotate(this.angle - Math.PI);
        }
        ctx.drawImage(image, -this.width / 2, -this.height / 2, this.width, this.height);
        ctx.restore();
    }
}


// King Bill — heavy variant of Bullet. Bigger sprite, denser/larger smoke
// trail, and *never* stompable: even a clean top-down landing on the head
// kills the panda. Reuses Bullet's motion, homing, render, and AABB code.
class KingBill extends Bullet {
    constructor() {
        super();
        this.isKingBill = true;
        // Big puffs at the cannon end (scale 5.0 → ≈110 px peak radius =
        // ~80% of the sprite's backside). Interval is loose so the trail
        // doesn't become a long packed rope behind the sprite — combined
        // with bounded puff lifetime in spawnSmokePuff, this keeps the tail
        // tight while the at-cannon plume stays fat.
        this.smokeIntervalMs = 26;
        this.smokeScale = 5.0;
        this.width = KING_BILL_BASE_WIDTH;
        // Keep the same width:height ratio as the normal bullet sprite until
        // the spawning manager passes its own image-derived height.
        this.height = KING_BILL_BASE_WIDTH * (30 / 70);
    }

    get stompable() { return false; }
}

class BulletManager {
    constructor(image, missileImage, difficulty) {
        this.image = image;
        this.aspect = image.naturalWidth / image.naturalHeight;
        // Missile shares the pool with normal bullets — same class, same
        // motion, same smoke trail. Only the image, speed, and stomp-rule
        // differ (handled per-instance via Bullet.kind).
        this.missileImage = missileImage;
        this.missileAspect = missileImage.naturalWidth / missileImage.naturalHeight;
        this.pool = [];
        for (let i = 0; i < 8; i++) this.pool.push(new Bullet());
        this.nextSpawnAt = 0;
        this.difficulty = difficulty;
    }

    reset() {
        for (const b of this.pool) b.active = false;
        // Brief grace period after a fresh start before any spawn check fires.
        this.nextSpawnAt = performance.now() + 1500;
    }

    activeCount() {
        let n = 0;
        for (const b of this.pool) if (b.active) n++;
        return n;
    }

    _countByKind(kind) {
        let n = 0;
        for (const b of this.pool) if (b.active && b.kind === kind && !b.isRetired()) n++;
        return n;
    }

    update(step, player, ascent, viewport, camera, particles, isPlaying) {
        // Night speed multiplier — applied live so in-flight bullets speed up
        // the moment night kicks in, not just newly spawned ones. Same factor
        // drives the exhaust-trail amp (bigger, more frequent puffs) so dark
        // bullets stay readable against the dark sky.
        const nightF = nightFactorAt(ascent);
        const speedMult = 1 + NIGHT_BULLET_SPEED_BOOST * nightF;
        for (const b of this.pool) {
            if (!b.active) continue;
            b.update(step, player, particles, speedMult, nightF);
            if (b.isOffscreen(viewport, camera.y)) b.active = false;
        }
        // Bullet-vs-bullet bonk: only normal bullets live in this pool, so
        // KingBill is automatically excluded from the resolver.
        this._resolveBulletCollisions(particles);

        if (!isPlaying) return;

        const now = performance.now();
        if (now < this.nextSpawnAt) return;
        // Night-time spawn bonus: +1 max alive once the night factor crosses
        // the threshold. Binary so the cap doesn't flap while ramping in.
        const capBonus = nightF > NIGHT_CAP_BONUS_THRESHOLD ? NIGHT_BULLET_CAP_BONUS : 0;
        if (this.activeCount() >= this.difficulty.maxBullets + capBonus) {
            this.nextSpawnAt = now + 600;
            return;
        }
        const interval = this._intervalAt(ascent);
        if (interval === Infinity) {
            this.nextSpawnAt = now + 800;
            return;
        }
        this._spawn(player, viewport, camera, ascent);
        this.nextSpawnAt = now + interval * 1000;
    }

    render(ctx, cameraY) {
        for (const b of this.pool) {
            if (!b.active) continue;
            const img = b.kind === 'missile' ? this.missileImage : this.image;
            b.render(ctx, cameraY, img);
        }
    }

    checkInteraction(player) {
        for (const b of this.pool) {
            if (!b.active) continue;
            if (!b.overlaps(player)) continue;
            // Stomp only valid when the bullet allows it (KingBill subclass
            // sets stompable=false, so its bonks always fall through to
            // head/body-kill — both end up at _strikeDeath).
            if (b.stompable && b.isStomp(player)) return { bullet: b, type: 'stomp' };
            if (b.isHeadHit(player))              return { bullet: b, type: 'head' };
            return                                       { bullet: b, type: 'body-kill' };
        }
        return null;
    }

    // Mario-bonk: when two normal bullets touch they reflect off each other
    // along the collision normal, briefly stop homing, and emit a spark
    // burst at the contact midpoint. After the lockout they re-home on the
    // panda independently. KingBill is in its own manager's pool, so it
    // never enters this resolver.
    _resolveBulletCollisions(particles) {
        const now = performance.now();
        const pool = this.pool;
        for (let i = 0; i < pool.length; i++) {
            const a = pool[i];
            if (!a.active) continue;
            for (let j = i + 1; j < pool.length; j++) {
                const b = pool[j];
                if (!b.active) continue;
                // Skip pairs still in their post-bonk lockout — prevents the
                // same two bullets from re-colliding next frame in place.
                if (now < a.knockStunnedUntil || now < b.knockStunnedUntil) continue;
                if (!this._bulletsOverlap(a, b)) continue;
                this._knockApart(a, b, particles, now);
            }
        }
    }

    _bulletsOverlap(a, b) {
        const rA = Math.min(a.width, a.height) * 0.4;
        const rB = Math.min(b.width, b.height) * 0.4;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        return (dx * dx + dy * dy) < (rA + rB) * (rA + rB);
    }

    _knockApart(a, b, particles, now) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d  = Math.hypot(dx, dy) || 1;
        const nx = dx / d;
        const ny = dy / d;
        // Reflect each velocity around the collision normal — billiard-style.
        const aProj = a.vx * nx + a.vy * ny;
        const bProj = b.vx * nx + b.vy * ny;
        a.vx -= 2 * aProj * nx; a.vy -= 2 * aProj * ny;
        b.vx -= 2 * bProj * nx; b.vy -= 2 * bProj * ny;
        a.angle = Math.atan2(a.vy, a.vx);
        b.angle = Math.atan2(b.vy, b.vx);
        // Snap them apart so the next frame's overlap test passes.
        a.x -= nx * 6; a.y -= ny * 6;
        b.x += nx * 6; b.y += ny * 6;
        // Brief homing lockout so the bonk reads visually before they re-track.
        a.knockStunnedUntil = now + 250;
        b.knockStunnedUntil = now + 250;
        particles.spawnSparkBurst((a.x + b.x) / 2, (a.y + b.y) / 2, 14);
    }

    _spawn(player, viewport, camera, ascent) {
        // Decide variant up-front so size/aspect/speed all agree.
        // Missiles share this spawn slot with normal bullets — when the dice
        // pick missile and we're under the cap, we spawn one; otherwise we
        // fall through to a normal bullet. So at high altitude missiles
        // *replace* normal bullets in the spawn cadence, not add to it.
        // Missile cap is altitude-aware: Hard mode allows 2 alive above
        // the boost threshold, otherwise 1. Other difficulties stay at
        // the hard-coded MISSILE_MAX_ALIVE baseline.
        const d = this.difficulty;
        let missileCap = (d && d.missileMaxAlive) || MISSILE_MAX_ALIVE;
        if (d && d.missileMaxAliveHigh && d.spawnCapBoostAtPx != null
            && ascent >= d.spawnCapBoostAtPx) {
            missileCap = d.missileMaxAliveHigh;
        }
        const wantMissile =
            this._countByKind('missile') < missileCap
            && Math.random() < this._missileChanceAt(ascent);
        const kind = wantMissile ? 'missile' : 'normal';
        const aspect = wantMissile ? this.missileAspect : this.aspect;
        const w = BULLET_BASE_WIDTH;     // missile is the same size as a normal bullet
        const h = w / aspect;
        const baseSpeed = this._speedAt(ascent);
        // Missile is faster than normal but hard-capped so it never outpaces
        // the panda's horizontal max — otherwise it becomes undodgeable at
        // high altitude on Hard (normal bullet alone reaches 600 px/sec).
        const speed = wantMissile
            ? Math.min(baseSpeed * MISSILE_SPEED_MULT, MISSILE_MAX_SPEED)
            : baseSpeed;
        let edge = choice(['left', 'right', 'top-left', 'top-right', 'top']);
        // Edge-hugging guard — if the panda is within BULLET_NEAR_EDGE_FRAC of
        // a side, redirect any same-side spawn (including the top-diagonal
        // variants) to the opposite side so the player always has dodge room.
        const leftZone  = viewport.w * BULLET_NEAR_EDGE_FRAC;
        const rightZone = viewport.w * (1 - BULLET_NEAR_EDGE_FRAC);
        if (player.x < leftZone) {
            if (edge === 'left')      edge = 'right';
            if (edge === 'top-left')  edge = 'top-right';
        } else if (player.x > rightZone) {
            if (edge === 'right')     edge = 'left';
            if (edge === 'top-right') edge = 'top-left';
        }
        let x, y;
        if (edge === 'left')          { x = -60;             y = player.y + randRange(-120, 120); }
        else if (edge === 'right')    { x = viewport.w + 60; y = player.y + randRange(-120, 120); }
        else if (edge === 'top-left') { x = -60;             y = camera.y - 80; }
        else if (edge === 'top-right'){ x = viewport.w + 60; y = camera.y - 80; }
        else {
            // 'top' — spawn above the viewport, with a *wide* horizontal
            // forbidden zone around the panda so a bullet from above is
            // never a near-instant drop onto the player. The homing
            // turn-rate still makes it a threat, but the player now has
            // meaningful lateral reaction room.
            const minOffset = Math.max(300, viewport.w * 0.35);
            const leftMax  = player.x - minOffset;
            const rightMin = player.x + minOffset;
            const leftAvail  = leftMax  > 0;
            const rightAvail = rightMin < viewport.w;
            if (leftAvail && rightAvail) {
                x = Math.random() < 0.5 ? randRange(0, leftMax) : randRange(rightMin, viewport.w);
            } else if (leftAvail) {
                x = randRange(0, leftMax);
            } else if (rightAvail) {
                x = randRange(rightMin, viewport.w);
            } else {
                // Viewport is too narrow to fit the forbidden zone — fall
                // back to whichever edge is farthest from the panda.
                x = (player.x > viewport.w / 2) ? 0 : viewport.w;
            }
            // Push the spawn a bit higher too so even a sharply-angled
            // homing turn has more distance to cover.
            y = camera.y - 160;
        }

        const b = this.pool.find(b => !b.active);
        if (!b) return;
        b.spawn(x, y, player.x, player.y + player.height / 2, speed, w, h, kind);
    }

    _speedAt(alt) {
        const base = this.difficulty.bulletSpeedBase;
        const cap  = this.difficulty.bulletSpeedCap;
        const bonus = lerp(0, cap - base, smoothstep(1500, 18000, alt));
        return Math.min(base + bonus, cap);
    }

    // Probability that the *next* spawn becomes a missile rather than a
    // normal bullet. Disabled on Easy. 0 below MISSILE_MIN_ALTITUDE, then
    // smoothsteps up to difficulty.missileChanceMax by altitude 18000.
    // Capped at 2 alive enforced separately by the caller.
    _missileChanceAt(alt) {
        if (!this.difficulty.missileEnabled) return 0;
        if (alt < MISSILE_MIN_ALTITUDE) return 0;
        return lerp(
            0,
            this.difficulty.missileChanceMax,
            smoothstep(MISSILE_MIN_ALTITUDE, 18000, alt)
        );
    }

    _intervalAt(alt) {
        if (alt < 1500) return Infinity;
        const mult = this.difficulty.bulletIntervalMult;
        if (alt < 4000) return randRange(6.0, 9.0) * mult;
        if (alt < 12000) return randRange(3.5, 6.0) * mult;
        return randRange(2.5, 4.5) * mult;
    }
}


// ============================================================
// KingBillManager — single-instance heavy bullet. Mirrors the
// shape of BulletManager (own pool of size 1) so all the wiring
// in Game treats it the same way. Side-only spawn, never on
// Easy, can't be stomped.
// ============================================================

class KingBillManager {
    constructor(image, difficulty) {
        this.image = image;
        this.aspect = image.naturalWidth / image.naturalHeight;
        // Three slots so Hard-mode altitude boost (cap=2) can still spawn
        // a replacement even if a retired KingBill is drifting offscreen
        // and both alive slots are occupied.
        this.pool = [new KingBill(), new KingBill(), new KingBill()];
        this.nextSpawnAt = 0;
        this.difficulty = difficulty;
    }

    reset() {
        for (const k of this.pool) k.active = false;
        // A bit longer grace than normal bullets — King Bill should never
        // greet the player on the very first jumps of a new run.
        this.nextSpawnAt = performance.now() + 4000;
    }

    // Only non-retired slots count — a retired KingBill is "out of the game"
    // for spawn-gating purposes even though its sprite is still on screen.
    activeCount() {
        let n = 0;
        for (const k of this.pool) if (k.active && !k.isRetired()) n++;
        return n;
    }

    update(step, player, ascent, viewport, camera, particles, isPlaying) {
        // Same live night speed boost as normal bullets so KingBill tracks
        // the day/night tempo. Cap stays difficulty-governed — no +1 at
        // night, since a second KingBill is a much bigger deal than +1
        // normal bullet. Trail amp uses the same nightFactor — on a big
        // black sprite the larger fire/smoke wake is especially helpful.
        const nightF = nightFactorAt(ascent);
        const speedMult = 1 + NIGHT_BULLET_SPEED_BOOST * nightF;
        for (const k of this.pool) {
            if (!k.active) continue;
            k.update(step, player, particles, speedMult, nightF);
            if (k.isOffscreen(viewport, camera.y)) k.active = false;
        }
        if (!isPlaying) return;
        if (!this.difficulty || !this.difficulty.kingBillEnabled) return;
        const now = performance.now();
        if (now < this.nextSpawnAt) return;
        // Altitude-aware cap: Hard mode allows a second KingBill past the
        // boost threshold. Lower difficulties keep the cap at 1.
        const d = this.difficulty;
        let cap = d.kingBillMaxAlive || 1;
        if (d.kingBillMaxAliveHigh && d.spawnCapBoostAtPx != null
            && ascent >= d.spawnCapBoostAtPx) {
            cap = d.kingBillMaxAliveHigh;
        }
        if (this.activeCount() >= cap) {
            this.nextSpawnAt = now + 800;
            return;
        }
        const interval = this._intervalAt(ascent);
        if (interval === Infinity) {
            this.nextSpawnAt = now + 1500;
            return;
        }
        if (!this._spawn(player, viewport, camera, ascent)) {
            // All slots occupied (e.g., retired KingBill still on screen).
            // Try again shortly.
            this.nextSpawnAt = now + 800;
            return;
        }
        // Backfill: in the boosted altitude zone the cap is 2, but the
        // normal interval (12–20s at alt 15k+) is longer than a
        // KingBill's homing fuse (~3–4.5s) — so without a tighter
        // follow-up the first one always retires before the second
        // spawns and the player only ever sees one on screen. If we
        // just spawned one and are still under cap, schedule the next
        // attempt within the fuse window.
        const boosted = cap > (d.kingBillMaxAlive || 1);
        if (boosted && this.activeCount() < cap) {
            this.nextSpawnAt = now + randRange(1500, 2800);
        } else {
            this.nextSpawnAt = now + interval * 1000;
        }
    }

    render(ctx, cameraY) {
        for (const k of this.pool) if (k.active) k.render(ctx, cameraY, this.image);
    }

    checkInteraction(player) {
        for (const k of this.pool) {
            if (!k.active) continue;
            if (!k.overlaps(player)) continue;
            // KingBill is never stompable — even a clean top-down landing kills.
            return { bullet: k, type: 'body-kill' };
        }
        return null;
    }

    _spawn(player, viewport, camera, ascent) {
        const slot = this.pool.find(k => !k.active);
        if (!slot) return false;
        const w = KING_BILL_BASE_WIDTH;
        const h = w / this.aspect;
        const speed = this._speedAt(ascent);
        // Side-only entry: never from above, to keep King Bill fair compared
        // to the normal bullet's top-edge spawns. If the panda is hugging one
        // edge (within BULLET_NEAR_EDGE_FRAC) force the spawn to the other
        // side — otherwise the heavy homing projectile is undodgeable.
        let fromLeft = Math.random() < 0.5;
        if (player.x < viewport.w * BULLET_NEAR_EDGE_FRAC)           fromLeft = false;
        else if (player.x > viewport.w * (1 - BULLET_NEAR_EDGE_FRAC)) fromLeft = true;
        const x = fromLeft ? -100 : viewport.w + 100;
        const y = player.y + randRange(-100, 100);
        slot.spawn(x, y, player.x, player.y + player.height / 2, speed, w, h);
        return true;
    }

    // Same speed-curve shape as normal bullets but a touch slower at the
    // top end — reads as "heavy", mass over agility.
    _speedAt(alt) {
        const base = this.difficulty.bulletSpeedBase * 0.9;
        const cap  = this.difficulty.bulletSpeedCap  * 0.9;
        const bonus = lerp(0, cap - base, smoothstep(1500, 18000, alt));
        return Math.min(base + bonus, cap);
    }

    // Much rarer than normal bullets: starts later (alt > 3000), longer
    // intervals overall, and even at high altitude no faster than ~12s.
    // `kingBillIntervalMult` lets Hard tighten the clock.
    _intervalAt(alt) {
        if (alt < 3000) return Infinity;
        const m = this.difficulty.kingBillIntervalMult;
        if (alt < 8000)  return randRange(20, 30) * m;
        if (alt < 15000) return randRange(15, 24) * m;
        return                randRange(12, 20) * m;
    }
}


// ============================================================
// Bird — rare +500 flyover. Stomp-from-above kills it and
// kicks off a cool tumble. Head-on contact kills the panda.
// Motion is X-axis one-way only; Y is monotonic (flat, gentle
// dive, or gentle climb — never an S-curve).
// ============================================================

class Bird {
    constructor() {
        this.active = false;
        this.isBird = true;
        this.state = 'flying';       // 'flying' | 'falling'
        this.x = 0; this.y = 0;
        this.prevY = 0;
        this.width = 0; this.height = 0;
        this.vx = 0;
        this.startY = 0;
        this.amplitude = 0;
        this.travelDist = 1;
        this.progressX = 0;
        this.fallVy = 0;
        this.fallGravity = 900;
        this.fallRotation = 0;
        this.fallRotSpeed = 0;
    }

    spawn(x, y, vx, width, height, travelDist, amplitude) {
        this.active = true;
        this.state = 'flying';
        this.x = x; this.y = y;
        this.prevY = y;
        this.vx = vx;
        this.width = width;
        this.height = height;
        this.travelDist = travelDist;
        this.startY = y;
        this.amplitude = amplitude;
        this.progressX = 0;
        this.fallVy = 0;
        this.fallRotation = 0;
        this.fallRotSpeed = 0;
    }

    update(step, viewport, cameraY) {
        this.prevY = this.y;
        const dt = step / 60;
        if (this.state === 'flying') {
            this.progressX += Math.abs(this.vx) * dt;
            const t = clamp(this.progressX / this.travelDist, 0, 1);
            this.x += this.vx * dt;
            this.y = this.startY + this.amplitude * (2 * t - t * t);
            // Deactivate when clear of the far edge.
            const margin = this.width;
            if (this.vx > 0 && this.x > viewport.w + margin) this.active = false;
            else if (this.vx < 0 && this.x < -margin) this.active = false;
        } else {
            // falling
            this.fallVy += this.fallGravity * dt;
            this.y += this.fallVy * dt;
            this.x += this.vx * 0.3 * dt;   // slight residual drift; gravity dominates
            this.fallRotation += this.fallRotSpeed * dt;
            if (this.y > cameraY + viewport.h + this.height * 2) this.active = false;
        }
    }

    overlaps(player) {
        const playerLeft  = player.x - player.width  / 2 + 6;
        const playerRight = player.x + player.width  / 2 - 6;
        const playerTop   = player.y;
        const playerBot   = player.y + player.height;
        const birdLeft  = this.x - this.width  * 0.38;
        const birdRight = this.x + this.width  * 0.38;
        const birdTop   = this.y - this.height * 0.35;
        const birdBot   = this.y + this.height * 0.35;
        return playerRight > birdLeft && playerLeft < birdRight
            && playerBot > birdTop && playerTop < birdBot;
    }

    // Mario stomp: panda descending AND its feet were above the bird's
    // hitbox top on the previous frame.
    isStomp(player) {
        return player.vy > 0 && player.prevFeetY <= this.hitboxTop;
    }

    get hitboxTop() { return this.y - this.height * 0.35; }
}


// ============================================================
// BirdManager — one bird at a time, rare spawn, off-screen
// above current camera so the player never sees the spawn.
// ============================================================

class BirdManager {
    constructor(image, difficulty) {
        this.image = image;
        this.aspect = image && image.naturalWidth
            ? image.naturalWidth / image.naturalHeight
            : 1.6;
        this.bird = new Bird();
        this.difficulty = difficulty;
        this.nextSpawnAt = performance.now() + this._initialDelay();
        // DOM <img> overlay — Chromium only animates GIF frames for
        // elements actually painting to screen, never for canvas drawImage.
        this.overlayEl = document.getElementById('bird-overlay');
    }

    reset() {
        this.bird.active = false;
        this.nextSpawnAt = performance.now() + this._initialDelay();
    }

    setDifficulty(d) { this.difficulty = d; }

    update(step, player, ascent, viewport, camera, particles, isPlaying) {
        if (this.bird.active) {
            this.bird.update(step, viewport, camera.y);
        }
        if (!isPlaying) return;
        if (this.bird.active) return;  // one bird at a time (flying or falling)
        const now = performance.now();
        if (now < this.nextSpawnAt) return;
        this._spawn(viewport, camera, ascent);
        this.nextSpawnAt = now + this._nextInterval();
    }

    render(ctx, cameraY) {
        const el = this.overlayEl;
        if (!el) return;
        if (!this.bird.active) {
            // Park off-screen via inline styles (beats the CSS class since
            // the live coords we set while flying are also inline).
            el.style.left = '-99999px';
            el.style.top  = '-99999px';
            return;
        }
        const b = this.bird;
        // Bird is a DOM <img>, so positions go in CSS pixels. The bird's
        // world coords (b.x, b.y, b.width, b.height) are logical — multiply
        // by WORLD_ZOOM to collapse into the on-screen canvas rect.
        const z = WORLD_ZOOM;
        el.style.width  = (b.width  * z) + 'px';
        el.style.height = (b.height * z) + 'px';
        el.style.left   = ((b.x - b.width  / 2) * z) + 'px';
        el.style.top    = ((b.y - cameraY - b.height / 2) * z) + 'px';
        let transform = '';
        if (b.vx < 0) transform += 'scaleX(-1) ';      // asset faces right; flip for left flight
        if (b.state === 'falling') transform += 'rotate(' + b.fallRotation + 'rad)';
        el.style.transform = transform.trim();
    }

    setViewport(newW, newH, oldW, oldH) {
        if (!this.bird.active) return;
        const fx = oldW > 0 ? newW / oldW : 1;
        const fy = oldH > 0 ? newH / oldH : 1;
        const b = this.bird;
        b.x *= fx;
        b.y *= fy;
        b.startY *= fy;
        b.travelDist *= fx;
        b.progressX *= fx;
        b.width *= fy;           // height-proportional scaling preserves aspect
        b.height *= fy;
    }

    _spawn(viewport, camera, ascent) {
        const fromLeft = Math.random() < 0.5;
        const h = clamp(viewport.h * 0.09, 46, 86);
        const w = h * this.aspect;
        const spawnMargin = w;
        const x = fromLeft ? -spawnMargin : viewport.w + spawnMargin;
        // Spawn 0.5 – 1.2 viewports ABOVE the camera so the player never sees
        // the appear; by the time they climb to that altitude the bird is
        // already mid-crossing.
        const altitudeAbove = randRange(viewport.h * 0.5, viewport.h * 1.2);
        const y = camera.y - altitudeAbove;
        const speed = this._speedAt(ascent);
        const vx = fromLeft ? speed : -speed;
        const travelDist = viewport.w + spawnMargin * 2;

        const roll = Math.random();
        let amplitude;
        if (roll < 0.40)      amplitude = 0;
        else if (roll < 0.70) amplitude = +randRange(40, 110);   // gentle dive
        else                  amplitude = -randRange(40, 110);   // gentle climb

        this.bird.spawn(x, y, vx, w, h, travelDist, amplitude);

        // Force a fresh GIF decode. Without this, Chromium may reuse a
        // paused decoder from the previous spawn and paint only frame 0.
        const el = this.overlayEl;
        if (el) {
            const src = el.getAttribute('src');
            if (src) {
                el.removeAttribute('src');
                el.setAttribute('src', src);
            }
        }
    }

    _speedAt(ascent) {
        const d = this.difficulty;
        const base = d.birdSpeedBase;
        const cap  = d.birdSpeedCap;
        const altitudeSpeed = base + (cap - base) * smoothstep(1500, 15000, ascent);
        // Night boost is applied at spawn time only — birds traverse the
        // screen quickly so re-multiplying vx mid-flight isn't needed.
        return altitudeSpeed * (1 + NIGHT_BIRD_SPEED_BOOST * nightFactorAt(ascent));
    }

    _nextInterval() {
        const d = this.difficulty;
        return randRange(d.birdIntervalMin, d.birdIntervalMax) * 1000;
    }

    _initialDelay() { return randRange(8, 14) * 1000; }
}


// ============================================================
// Jetpack — rare purple-glow pickup. Static position, bob + pulse
// for visual life. Touch it → panda equips; next one can't spawn
// until the equipped jetpack is spent (or this one floats past).
// ============================================================

class Jetpack {
    constructor() {
        this.active = false;
        this.x = 0; this.y = 0;
        this.width = 0; this.height = 0;
        this.bornAt = 0;
    }
    spawn(x, y, w, h) {
        this.active = true;
        this.x = x; this.y = y;
        this.width = w; this.height = h;
        this.bornAt = performance.now();
    }
    overlaps(player) {
        const halfPW = player.width / 2;
        const pL = player.x - halfPW + FOOT_INSET;
        const pR = player.x + halfPW - FOOT_INSET;
        const pT = player.y;
        const pB = player.y + player.height;
        const jL = this.x - this.width  * 0.45;
        const jR = this.x + this.width  * 0.45;
        const jT = this.y - this.height * 0.45;
        const jB = this.y + this.height * 0.45;
        return pR > jL && pL < jR && pB > jT && pT < jB;
    }
    isOffscreenBelow(cameraY, viewportH) {
        return this.y > cameraY + viewportH + this.height * 2;
    }
}


// ============================================================
// JetpackManager — single-instance spawner. Off-screen above
// the camera so the player never sees the pop-in. Spawn clock
// is PAUSED while the player is equipped (user rule).
// ============================================================

class JetpackManager {
    constructor(image, difficulty) {
        this.image = image;
        this.aspect = image && image.naturalWidth
            ? image.naturalWidth / image.naturalHeight
            : 0.9;
        this.jetpack = new Jetpack();
        this.difficulty = difficulty;   // { jetpackIntervalMin, jetpackIntervalMax }
        this.nextSpawnAt = performance.now() + this._initialDelay();
    }

    reset() {
        this.jetpack.active = false;
        this.nextSpawnAt = performance.now() + this._initialDelay();
    }

    setDifficulty(d) { this.difficulty = d; }

    update(step, player, viewport, camera, isPlaying, playerEquipped) {
        if (this.jetpack.active && this.jetpack.isOffscreenBelow(camera.y, viewport.h)) {
            // Missed — player climbed past without touching it. Start the
            // countdown from now.
            this.jetpack.active = false;
            this.nextSpawnAt = performance.now() + this._nextInterval();
        }
        if (!isPlaying) return;
        if (this.jetpack.active) return;    // one at a time
        if (playerEquipped) return;         // user rule: clock paused while equipped
        if (performance.now() < this.nextSpawnAt) return;
        this._spawn(viewport, camera);
    }

    // Called by Game the frame fuel hits 0 — kicks the next countdown from
    // exactly that moment (not periodic).
    onPlayerJetpackExpired() {
        this.nextSpawnAt = performance.now() + this._nextInterval();
    }

    render(ctx, cameraY) {
        if (!this.jetpack.active) return;
        const j = this.jetpack;
        const age = performance.now() - j.bornAt;
        const bob = Math.sin(age / 420) * 4;
        const pulse = 1 + Math.sin(age / 600) * 0.03;
        ctx.save();
        ctx.translate(j.x, j.y - cameraY + bob);
        ctx.scale(pulse, pulse);
        ctx.drawImage(this.image, -j.width / 2, -j.height / 2, j.width, j.height);
        ctx.restore();
    }

    setViewport(newW, newH, oldW, oldH) {
        if (!this.jetpack.active) return;
        const fx = oldW > 0 ? newW / oldW : 1;
        const fy = oldH > 0 ? newH / oldH : 1;
        this.jetpack.x *= fx;
        this.jetpack.y *= fy;
    }

    _spawn(viewport, camera) {
        const w = JETPACK_PICKUP_WIDTH;
        const h = w / this.aspect;
        const margin = w;
        const x = randRange(margin, viewport.w - margin);
        // 0.5 – 1.3 viewports above the camera — always off-screen at spawn.
        const altitudeAbove = randRange(viewport.h * 0.5, viewport.h * 1.3);
        const y = camera.y - altitudeAbove;
        this.jetpack.spawn(x, y, w, h);
    }
    _nextInterval() {
        const d = this.difficulty;
        return randRange(d.jetpackIntervalMin, d.jetpackIntervalMax) * 1000;
    }
    _initialDelay() { return randRange(20, 35) * 1000; }
}


// ============================================================
// Coin — small pooled pickup worth +1 to the lifetime coin
// balance. Spawns in four shapes (above-cloud, arc-trail
// between clouds, vertical column, scatter). AABB collision
// with the panda mirrors the Jetpack.overlaps pattern.
// ============================================================

const COIN_PICKUP_WIDTH = 32;          // fixed px — coins stay readable at any altitude
// Invisible halo around each coin so pickup is forgiving. The sprite is
// 32px but collision treats the coin as ~32+2*HALO px wide. Kept smaller
// than COIN_MIN_DISTANCE/2 so neighboring hitboxes can never overlap.
const COIN_HITBOX_HALO = 20;
const COIN_DEATH_BONUS_K = 1.5;        // coins on death = floor(sqrt(score) * K)
const COIN_POPUP_COLOR = '#ffcf00';    // matches the gold HUD color
// Density controls — prevent tight clusters and runaway rows. Min distance
// is measured center-to-center (coin is 32px wide, so 90 leaves ~nearly two
// coin-widths of air between neighbors). Per-row cap limits how many coins
// a single cloud-row spawn event can drop across all four shapes combined.
const COIN_MIN_DISTANCE = 90;
const COIN_MAX_PER_ROW  = 4;
// Independent per-cloud-row rolls. A single row can fire multiple shapes.
const COIN_SPAWN_CHANCES = {
    aboveCloud: 0.50,
    arcTrail:   0.25,
    column:     0.15,
    scatter:    0.10
};

class Coin {
    constructor() {
        this.active = false;
        this.x = 0; this.y = 0;
        this.width  = COIN_PICKUP_WIDTH;
        this.height = COIN_PICKUP_WIDTH;
        this.bornAt = 0;
        this.phase = 0;   // phase offset so a trail of coins bobs out of sync
    }
    spawn(x, y, phase = 0) {
        this.active = true;
        this.x = x; this.y = y;
        this.bornAt = performance.now();
        this.phase = phase;
    }
    overlaps(player) {
        const halfPW = player.width / 2;
        const pL = player.x - halfPW + FOOT_INSET;
        const pR = player.x + halfPW - FOOT_INSET;
        const pT = player.y;
        const pB = player.y + player.height;
        // Pickup hitbox is the sprite PLUS a generous invisible halo so the
        // panda doesn't need a pixel-perfect pass. Halo is the same on both
        // axes — coin reads as a circle at this size.
        const halfW = this.width  / 2 + COIN_HITBOX_HALO;
        const halfH = this.height / 2 + COIN_HITBOX_HALO;
        const cL = this.x - halfW;
        const cR = this.x + halfW;
        const cT = this.y - halfH;
        const cB = this.y + halfH;
        return pR > cL && pL < cR && pB > cT && pT < cB;
    }
    isOffscreenBelow(cameraY, viewportH) {
        return this.y > cameraY + viewportH + this.height * 2;
    }
}

// ============================================================
// CoinManager — pool of Coin instances. Spawns are triggered
// externally (by CloudManager during cloud-row generation);
// update/render/cull happen here per frame.
// ============================================================

class CoinManager {
    constructor(image) {
        this.image = image;
        this.aspect = image && image.naturalWidth
            ? image.naturalWidth / image.naturalHeight
            : 1;
        // Pool size covers the deepest simultaneous fill: a couple of arc
        // trails (~6 each) + a column (~4) + scatter + above-cloud coins in
        // the upward spawn window. 64 is comfortable headroom.
        this.pool = [];
        for (let i = 0; i < 64; i++) this.pool.push(new Coin());
        // Per-spawn-event budget. CloudManager calls beginRow(n) before each
        // cloud-row's coin rolls; _tryPlace decrements it. Infinity means
        // "uncapped" (used outside the row context; current code only calls
        // spawns through beginRow so this path is defensive).
        this._rowBudget = Infinity;
    }

    reset() {
        for (const c of this.pool) c.active = false;
        this._rowBudget = Infinity;
    }

    // Set the cap for the next burst of spawn calls. Call once per cloud-row.
    beginRow(max) { this._rowBudget = max; }

    // Rejects candidates that would overlap an existing coin (< COIN_MIN_DISTANCE
    // center-to-center) or that exceed the current row budget. Returns the
    // placed Coin, or null if rejected.
    _tryPlace(x, y) {
        if (this._rowBudget <= 0) return null;
        const minSq = COIN_MIN_DISTANCE * COIN_MIN_DISTANCE;
        for (const c of this.pool) {
            if (!c.active) continue;
            const dx = c.x - x, dy = c.y - y;
            if (dx * dx + dy * dy < minSq) return null;
        }
        for (const c of this.pool) {
            if (!c.active) {
                c.spawn(x, y, Math.random() * Math.PI * 2);
                this._rowBudget--;
                return c;
            }
        }
        return null;   // pool full — silently drop
    }

    spawnAbove(cloud) {
        const x = cloud.x;
        // Float a little above the cloud's visible top (hitboxTop sits 15%
        // into the sprite; the visible top is at cloud.y).
        const y = cloud.y - randRange(40, 70);
        this._tryPlace(x, y);
    }

    // 4-6 coins on a quadratic arc from prev cloud's top to next cloud's top,
    // peaking 80-120px above the straight line. Rewards staying on the
    // natural jump path between consecutive clouds. Candidates that fall
    // within COIN_MIN_DISTANCE of an already-placed coin are dropped, so
    // tight cloud gaps self-regulate to fewer coins.
    spawnArcTrail(fromCloud, toCloud) {
        const count = 4 + Math.floor(Math.random() * 3);   // 4-6
        const x0 = fromCloud.x, y0 = fromCloud.y;
        const x1 = toCloud.x,   y1 = toCloud.y;
        const peak = randRange(80, 120);
        const cx = (x0 + x1) / 2;
        const cy = Math.min(y0, y1) - peak;
        for (let i = 0; i < count; i++) {
            const t = (i + 1) / (count + 1);
            const u = 1 - t;
            const x = u * u * x0 + 2 * u * t * cx + t * t * x1;
            const y = u * u * y0 + 2 * u * t * cy + t * t * y1;
            this._tryPlace(x, y);
        }
    }

    // 3-4 coins stacked vertically in the gap between two clouds. Spacing
    // matches COIN_MIN_DISTANCE so the stack doesn't self-reject.
    spawnColumn(fromCloud, toCloud) {
        const count = 3 + Math.floor(Math.random() * 2);   // 3-4
        // Place the column roughly midway horizontally but offset so it
        // doesn't collide with arc trails that also sit on the midpoint.
        const baseX = (fromCloud.x + toCloud.x) / 2 + randRange(-60, 60);
        const midY = (fromCloud.y + toCloud.y) / 2;
        const spacing = COIN_MIN_DISTANCE;
        const startY = midY - (count - 1) * spacing / 2;
        for (let i = 0; i < count; i++) {
            this._tryPlace(baseX, startY + i * spacing);
        }
    }

    // A lone coin somewhere in the gap between the two clouds.
    spawnScatter(fromCloud, toCloud, viewportW) {
        const margin = 40;
        const x = clamp(
            randRange(margin, viewportW - margin),
            margin, viewportW - margin
        );
        const y = randRange(
            Math.min(fromCloud.y, toCloud.y) - 20,
            Math.max(fromCloud.y, toCloud.y) + 20
        );
        this._tryPlace(x, y);
    }

    update(step, player, camera, viewport, onPickup) {
        for (const c of this.pool) {
            if (!c.active) continue;
            if (c.overlaps(player)) {
                c.active = false;
                onPickup(c.x, c.y);
                continue;
            }
            if (c.isOffscreenBelow(camera.y, viewport.h)) {
                c.active = false;
            }
        }
    }

    render(ctx, cameraY) {
        const now = performance.now();
        for (const c of this.pool) {
            if (!c.active) continue;
            const age = now - c.bornAt;
            const bob = Math.sin(age / 420 + c.phase) * 4;
            // Subtle horizontal scale wobble reads as a coin rotating on its axis.
            const spin = 0.75 + Math.abs(Math.cos(age / 500 + c.phase)) * 0.25;
            ctx.save();
            ctx.translate(c.x, c.y - cameraY + bob);
            ctx.scale(spin, 1);
            ctx.drawImage(this.image, -c.width / 2, -c.height / 2, c.width, c.height);
            ctx.restore();
        }
    }

    setViewport(newW, newH, oldW, oldH) {
        if (!(oldW > 0) || oldW === newW) return;
        const fx = newW / oldW;
        const fy = oldH > 0 ? newH / oldH : 1;
        for (const c of this.pool) {
            if (!c.active) continue;
            c.x *= fx;
            c.y *= fy;
        }
    }
}


// ============================================================
// PlasmaShot — single tracer projectile fired by a weapon
// ============================================================

class PlasmaShot {
    constructor() {
        this.active = false;
        this.x = 0; this.y = 0;          // head, world coords
        this.tailX = 0; this.tailY = 0;  // trails behind by `projectileLongPx`
        this.vx = 0; this.vy = 0;        // px / sec
        this.expiresAt = 0;
        this.weapon = null;
        // If auto-aim had a lock at fire time, remember it so the MISSED
        // popup only appears for shots that were actually aimed. A click
        // into empty sky leaves this null and no popup is emitted.
        this.aimTargetAtFire = null;
    }

    spawn(x, y, dx, dy, weapon, aimTargetAtFire = null) {
        this.active = true;
        this.x = x; this.y = y;
        this.tailX = x; this.tailY = y;
        const s = weapon.projectileSpeed;
        this.vx = dx * s; this.vy = dy * s;
        this.expiresAt = performance.now() + weapon.projectileLifeMs;
        this.weapon = weapon;
        this.aimTargetAtFire = aimTargetAtFire;
    }

    update(step) {
        const dt = step / 60;            // step is in 60Hz frames → seconds
        // Ballistic drop (opt-in per weapon). Applied before the position
        // step so the tail direction below reflects the post-gravity velocity
        // and the tracer visibly curls downward over distance.
        const g = this.weapon.projectileGravity;
        if (g) this.vy += g * dt;
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        // Tail trails behind by the oval's long axis. Used by the swept-hit
        // test so a fast projectile can't tunnel past a bullet between frames.
        const len = this.weapon.projectileLongPx;
        const sp  = Math.hypot(this.vx, this.vy) || 1;
        this.tailX = this.x - (this.vx / sp) * len;
        this.tailY = this.y - (this.vy / sp) * len;
    }

    isOffscreen(viewport, cameraY) {
        const sy = this.y - cameraY;
        return sy < -200 || sy > viewport.h + 200
            || this.x < -200 || this.x > viewport.w + 200;
    }

    // Distance from point (cx,cy) to the segment (tail → head) is < r.
    intersectsCircle(cx, cy, r) {
        const x1 = this.tailX, y1 = this.tailY, x2 = this.x, y2 = this.y;
        const dx = x2 - x1, dy = y2 - y1;
        const len2 = dx * dx + dy * dy || 1e-9;
        let t = ((cx - x1) * dx + (cy - y1) * dy) / len2;
        t = clamp(t, 0, 1);
        const px = x1 + t * dx, py = y1 + t * dy;
        const ex = cx - px, ey = cy - py;
        return (ex * ex + ey * ey) < r * r;
    }

    render(ctx, cameraY) {
        const w = this.weapon;
        // Centered between tail and head so the oval visually represents the
        // swept hit segment exactly (also matches what the player intuits as
        // "the bullet" while it's in motion).
        const cx = (this.x + this.tailX) * 0.5;
        const cy = (this.y + this.tailY) * 0.5 - cameraY;
        const angle = Math.atan2(this.vy, this.vx);
        const longR  = w.projectileLongPx  * 0.5;
        const shortR = w.projectileWidthPx * 0.5;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(angle);
        // Outer halo — softest, biggest
        ctx.fillStyle = w.projectileColorOuter;
        ctx.beginPath();
        ctx.ellipse(0, 0, longR * 1.25, shortR * 1.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Mid glow — the recognisable green oval
        ctx.fillStyle = w.projectileColorGlow;
        ctx.beginPath();
        ctx.ellipse(0, 0, longR, shortR, 0, 0, Math.PI * 2);
        ctx.fill();
        // Hot core — near-white inside
        ctx.fillStyle = w.projectileColorCore;
        ctx.beginPath();
        ctx.ellipse(0, 0, longR * 0.55, shortR * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}


// ============================================================
// RocketShot — sprite-based homing projectile fired by a 'rocket'-kind
// weapon (the Bazooka). Unlike PlasmaShot this is an image that rotates
// along its velocity vector, steers toward a locked target at a capped
// turn rate, leaves a small smoke+fire trail, and asks WeaponSystem to
// detonate it with splash damage on impact or fuse expiry.
// ============================================================

class RocketShot {
    constructor() {
        this.active = false;
        this.x = 0; this.y = 0;          // world coords (rocket center)
        this.vx = 0; this.vy = 0;        // px/sec
        this.angle = 0;                  // rad — velocity direction
        this.weapon = null;
        // Target enemy object captured at fire time. Null for a
        // straight-shot rocket fired into empty sky.
        this.target = null;
        // True if the rocket was fired WITH a locked target. Drives fuse
        // behavior: homing rockets detonate on fuse expiry; straight
        // rockets just burn out silently when the fuse runs or they
        // leave the viewport (so an empty-sky miss doesn't explode).
        this.wasAimed = false;
        this.expiresAt = 0;
        this.smokeTimer = 0;
    }

    spawn(x, y, dx, dy, weapon, target) {
        this.active = true;
        this.x = x; this.y = y;
        const s = weapon.rocketSpeed;
        this.vx = dx * s; this.vy = dy * s;
        this.angle = Math.atan2(this.vy, this.vx);
        this.weapon = weapon;
        this.target = target || null;
        this.wasAimed = !!target;
        this.expiresAt = performance.now() + weapon.rocketLifeMs;
        this.smokeTimer = 0;
    }

    // Steer toward target (if still tracking) and advance position.
    // Emits a throttled smoke+fire puff anchored to the rocket's tail.
    update(step, particles) {
        const w = this.weapon;
        const targetLive = this.target
            && this.target.active
            && !(this.target.isRetired && this.target.isRetired());
        if (targetLive) {
            const desired = Math.atan2(
                this.target.y - this.y,
                this.target.x - this.x
            );
            let delta = desired - this.angle;
            while (delta > Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            // Turn rate expressed in deg/sec → rad per 60Hz-step.
            const maxTurn = (w.rocketTurnRateDegPerSec * Math.PI / 180) * (step / 60);
            if (delta > maxTurn) delta = maxTurn;
            else if (delta < -maxTurn) delta = -maxTurn;
            this.angle += delta;
            this.vx = Math.cos(this.angle) * w.rocketSpeed;
            this.vy = Math.sin(this.angle) * w.rocketSpeed;
        }
        // (Target gone → keep current velocity and drift.)
        this.x += this.vx * (step / 60);
        this.y += this.vy * (step / 60);
        // Smoke/fire trail anchored to a configurable tail point.
        this.smokeTimer += step * (1000 / 60);
        if (this.smokeTimer >= w.rocketSmokeEmitEveryMs) {
            const cosA = Math.cos(this.angle);
            const sinA = Math.sin(this.angle);
            const axis  = w.rocketWidthPx  * w.rocketSmokeTailAxisFrac;
            const cross = w.rocketHeightPx * w.rocketSmokeTailCrossFrac;
            // Backward along axis, plus a small perpendicular offset.
            const tailX = this.x - cosA * axis - sinA * cross;
            const tailY = this.y - sinA * axis + cosA * cross;
            particles.spawnSmokePuff(tailX, tailY, w.rocketSmokeScale);
            if (w.rocketFireScale > 0) {
                particles.spawnBulletFlame(tailX, tailY, w.rocketFireScale);
            }
            this.smokeTimer = 0;
        }
    }

    isOffscreen(viewport, cameraY) {
        const m = 200;
        return this.x < -m
            || this.x > viewport.w + m
            || this.y < cameraY - m
            || this.y > cameraY + viewport.h + m;
    }

    // Point-radius check — the rocket's hit point is its center.
    intersectsCircle(cx, cy, r) {
        const dx = cx - this.x, dy = cy - this.y;
        return (dx * dx + dy * dy) < r * r;
    }

    // Inverse of Bullet.render — the rocket sprite's natural facing
    // is RIGHT (not left like the bullet art), so the mirror branches
    // are swapped: mirror when velocity points LEFT, not when it
    // points right. Without this, the rocket flies tail-first and the
    // smoke trail emits from the nose.
    render(ctx, cameraY, image) {
        if (!image) return;
        const w = this.weapon;
        const screenY = this.y - cameraY;
        ctx.save();
        ctx.translate(this.x, screenY);
        if (Math.cos(this.angle) > 0) {
            ctx.rotate(this.angle);
        } else {
            ctx.scale(-1, 1);
            ctx.rotate(-(this.angle - Math.PI));
        }
        ctx.drawImage(
            image,
            -w.rocketWidthPx / 2, -w.rocketHeightPx / 2,
            w.rocketWidthPx, w.rocketHeightPx
        );
        ctx.restore();
    }
}


// ============================================================
// WeaponSystem — auto-fires from the player's equipped weapon and
// resolves projectile-vs-enemy hits. KingBillManager IS passed in but
// the resolver and the target picker only act on it when the weapon's
// `canKillKingBill` flag is true (M16 can; raygun cannot).
// ============================================================

class WeaponSystem {
    constructor() {
        this.pool = [];
        // Pool sized to accommodate the minigun's triple-barrel salvo at
        // 50 rps cadence (150 shots/sec peak) with multi-second tracer
        // lifetimes. Rifles barely use this many slots; the hose gun
        // starves a small pool and visibly "bursts" when slots run out.
        for (let i = 0; i < 192; i++) this.pool.push(new PlasmaShot());
        // Separate pool for rocket-kind projectiles (Bazooka). Low ROF →
        // a handful of slots is plenty even with overlapping detonations.
        this.rocketPool = [];
        for (let i = 0; i < 6; i++) this.rocketPool.push(new RocketShot());
        this.lastShotAt = 0;          // performance.now() of last fired shot
        // Overheat state — weapons that declare `overheatMaxShots` build heat
        // per shot and cool passively. When heat hits the cap the weapon
        // locks out firing until it drops back below `overheatResumeAt`.
        // Only one weapon is equipped at a time, so single shared slot is fine.
        this.heat = 0;
        this.heatLastTick = 0;
        this.overheated = false;
        // Timestamp of the last overheat-smoke emission. Throttles the
        // spawn rate so we don't flood the particle pool while the weapon
        // is venting.
        this.overheatSmokeAt = 0;
        // Fire-cycle state (generic — for any weapon with preFire/sustained/
        // postFire sound keys). 'idle' = trigger up. 'spinup' = preFire
        // sound playing, first shot not yet allowed. 'firing' = sustained
        // sound playing, shots firing at cadence. Transitions emit events
        // into `recentShots` using the `mode` field (see Game drain loop).
        this.fireCycle = 'idle';
        this.fireCycleStartedAt = 0;
        // Drained by Game after each update — each entry is { kind, points, x, y }.
        // WeaponSystem owns the visual + state effects; Game owns score/HUD.
        this.recentKills = [];
        // Drained by Game to play per-shot SFX. Entries look like
        // { soundKey, volume } — used for BOTH fire SFX and explosion SFX
        // (the drain loop just looks up the AudioPool by key).
        this.recentShots = [];
        // Staggered salvo queue. For weapons whose config declares
        // `barrelOffsets`, `_fire` pushes one entry per barrel (after the
        // first) with a future `fireAt` so the barrels emerge top→middle→
        // bottom rather than all at the same instant. Each entry looks
        // like { fireAt, barrelOffset, target }.
        this.pendingShots = [];
        // Deferred one-shot SFX queue — used when a sound needs to fire on
        // a delay (e.g. the overheat SFX waiting for the ending clip to
        // finish). Entries: { fireAt, soundKey, volume }.
        this.pendingSounds = [];
        // Set by Game after boot so rocket sprites can look up their
        // image without Game having to pass it through render().
        this.assets = null;
        // Hit-marker lock: remembers the target the auto-aim has been
        // pointing at and when the lock started. Game polls via
        // renderHitMarker — fresh picks reset the timer so rapid target
        // swaps don't flash crosshairs everywhere.
        this.aimTarget = null;
        this.aimLockedAt = 0;
        // `aimTarget` is the *candidate* under dwell; `lockedTarget` is
        // the actual aim-assist target — only populated once the dwell
        // reaches AIM_LOCK_DELAY_MS. Fire reads lockedTarget.
        this.lockedTarget = null;
    }

    reset() {
        for (const p of this.pool) p.active = false;
        for (const r of this.rocketPool) r.active = false;
        this.lastShotAt = 0;
        this.recentKills.length = 0;
        this.recentShots.length = 0;
        this.pendingShots.length = 0;
        this.pendingSounds.length = 0;
        this.aimTarget = null;
        this.aimLockedAt = 0;
        this.lockedTarget = null;
        this.heat = 0;
        this.heatLastTick = 0;
        this.overheated = false;
        this.overheatSmokeAt = 0;
        this._endFireCycle(true);
    }

    // Tear down any active fire-cycle cleanly. Always stops the sustained
    // loop; only emits postFire when we had actually started firing (so a
    // spin-up that's interrupted stays silent). `silent=true` skips the
    // postFire sound entirely (used on hard resets like game-over).
    _endFireCycle(silent = false) {
        // Drop any queued staggered-barrel shots so they don't fire after
        // the sustained loop has already stopped. Pending deferred SFX
        // (e.g. a delayed overheat chime) are intentionally LEFT in place
        // — they were scheduled relative to this cycle's events and should
        // still play on time even if the cycle unwinds early.
        this.pendingShots.length = 0;
        if (this.fireCycle === 'idle') return;
        const w = this._lastCycleWeapon;
        if (this.fireCycle === 'firing') {
            this.recentShots.push({ mode: 'sustained-stop' });
            if (!silent && w && w.postFireSoundKey) {
                this.recentShots.push({
                    mode: 'one-shot',
                    soundKey: w.postFireSoundKey,
                    volume: w.postFireSoundVolume != null ? w.postFireSoundVolume : 0.4
                });
            }
        }
        this.fireCycle = 'idle';
        this.fireCycleStartedAt = 0;
        this._lastCycleWeapon = null;
    }

    drainKills() {
        const k = this.recentKills;
        this.recentKills = [];
        return k;
    }

    drainShots() {
        const s = this.recentShots;
        this.recentShots = [];
        return s;
    }

    shiftSchedule(pausedFor) {
        if (this.lastShotAt > 0) this.lastShotAt += pausedFor;
        for (const p of this.pool) if (p.active) p.expiresAt += pausedFor;
        for (const r of this.rocketPool) if (r.active) r.expiresAt += pausedFor;
        for (const s of this.pendingShots) s.fireAt += pausedFor;
        for (const s of this.pendingSounds) s.fireAt += pausedFor;
    }

    update(step, player, input, bulletManager, kingBillManager, birdManager, particles, viewport, camera, isPlaying) {
        const now = performance.now();
        // Tick projectiles regardless of isPlaying — anything in flight at
        // game-over still completes (matches bird/storm behavior).
        for (const p of this.pool) {
            if (!p.active) continue;
            p.update(step);
        }
        // Release any queued staggered-barrel shots whose fire time has
        // arrived. Runs before the new-fire decision so the tail of a
        // previous salvo completes even if `shouldFire` is false this tick.
        if (this.pendingShots.length && player && player.weapon && player.armEquipped) {
            const due = [];
            const keep = [];
            for (const s of this.pendingShots) {
                if (s.fireAt <= now) due.push(s);
                else keep.push(s);
            }
            this.pendingShots = keep;
            for (const s of due) {
                this._spawnShot(player, particles, camera.y, s.barrelOffset, s.target);
            }
        }
        // Drain any deferred one-shot SFX whose wait has elapsed. Unlike
        // pendingShots, this runs unconditionally (even with no weapon
        // equipped) so a scheduled overheat chime still plays if the
        // player swaps weapons mid-delay.
        if (this.pendingSounds.length) {
            const keepSnd = [];
            for (const s of this.pendingSounds) {
                if (s.fireAt <= now) {
                    this.recentShots.push({
                        mode: 'one-shot',
                        soundKey: s.soundKey,
                        volume: s.volume
                    });
                } else {
                    keepSnd.push(s);
                }
            }
            this.pendingSounds = keepSnd;
        }
        // Resolve hits FIRST, then expire leftovers. This ordering means a
        // shot that lands on its last frame still counts AND a shot that
        // times out/goes offscreen without connecting is the signal we use
        // to spawn the MISSED popup below.
        this._resolveHits(bulletManager, kingBillManager, birdManager, particles);
        for (const p of this.pool) {
            if (!p.active) continue;
            if (now < p.expiresAt && !p.isOffscreen(viewport, camera.y)) continue;
            // Expired without a hit. If auto-aim had a lock when this shot
            // was fired, drop a grey "MISSED" popup at the projectile's
            // death point (clamped to the visible viewport so offscreen
            // despawns still read).
            if (p.aimTargetAtFire) {
                const mx = clamp(p.x, 12, viewport.w - 12);
                const my = clamp(p.y, camera.y + 12, camera.y + viewport.h - 12);
                particles.spawnPopup(mx, my, 0, '#c8c8c8', 22, 'MISSED');
            }
            p.active = false;
        }

        // ---- Rockets ----
        // Tick, then check for detonation triggers: (1) the rocket's
        // locked target was contacted, (2) the rocket grazed any other
        // eligible enemy in its path, (3) fuse expired (aimed rockets
        // detonate; straight-shot rockets just burn out), (4) offscreen
        // (always silent — no boom off the player's screen).
        for (const r of this.rocketPool) {
            if (!r.active) continue;
            r.update(step, particles);
            const w = r.weapon;
            let detonate = false;
            // (1) locked-target contact
            if (r.target && r.target.active) {
                const t = r.target;
                const rad = Math.min(t.width || 32, t.height || 32) * 0.4;
                if (r.intersectsCircle(t.x, t.y, rad)) detonate = true;
            }
            // (2) generic contact — any killable enemy in the path
            if (!detonate) {
                for (const b of bulletManager.pool) {
                    if (!b.active) continue;
                    if (b.kind === 'missile' && !w.canKillMissile)      continue;
                    if (b.kind === 'normal'  && !w.canKillNormalBullet) continue;
                    const rad = Math.min(b.width, b.height) * 0.4;
                    if (r.intersectsCircle(b.x, b.y, rad)) { detonate = true; break; }
                }
            }
            if (!detonate && w.canKillKingBill && kingBillManager) {
                for (const kb of kingBillManager.pool) {
                    if (!kb.active) continue;
                    const rad = Math.min(kb.width, kb.height) * 0.4;
                    if (r.intersectsCircle(kb.x, kb.y, rad)) { detonate = true; break; }
                }
            }
            if (!detonate && w.canKillBird && birdManager
                && birdManager.bird.active
                && birdManager.bird.state === 'flying') {
                const bd = birdManager.bird;
                const rad = Math.min(bd.width * 0.38, bd.height * 0.35);
                if (r.intersectsCircle(bd.x, bd.y, rad)) detonate = true;
            }
            if (detonate) {
                this._detonateRocket(r, particles, bulletManager, kingBillManager, birdManager);
                r.active = false;
                continue;
            }
            // (3) fuse expired — aimed rockets boom at their current
            // position; straight shots disappear silently (empty-sky
            // clicks don't get a free splash kill).
            if (now >= r.expiresAt) {
                if (r.wasAimed) {
                    this._detonateRocket(r, particles, bulletManager, kingBillManager, birdManager);
                }
                r.active = false;
                continue;
            }
            // (4) offscreen — silent deactivation in both cases.
            if (r.isOffscreen(viewport, camera.y)) {
                r.active = false;
            }
        }

        if (!isPlaying) {
            // Discard any buffered click while not in play (e.g. Play Again
            // button press shouldn't queue a shot for the new run). If a
            // sustained-fire cycle was in flight when play stopped, unwind
            // it cleanly so the loop audio doesn't keep roaring.
            if (input) input.fireRequested = false;
            this.aimTarget = null;
            this.aimLockedAt = 0;
            this.lockedTarget = null;
            if (this.fireCycle !== 'idle') this._endFireCycle();
            return;
        }
        if (!player.weapon || !player.armEquipped) {
            this.aimTarget = null;
            this.aimLockedAt = 0;
            this.lockedTarget = null;
            return;
        }

        // Smart aim: each frame snap-track the highest-priority valid target
        // (tiered: missile → king bill → normal → bird) and lerp the displayed
        // arm toward it. With no target, run the idle motion (slow bob + jump
        // tilt) so the gun feels alive.
        const target = this._pickTarget(player, bulletManager, kingBillManager, birdManager);
        // Track aim-lock for the hit-marker feature: new target (or none)
        // resets the timer. Same target across frames accrues dwell time.
        if (target !== this.aimTarget) {
            this.aimTarget = target || null;
            this.aimLockedAt = target ? now : 0;
        }
        // Dwell gating — the lock isn't REAL until the aim has rested on
        // the target for AIM_LOCK_DELAY_MS. Before dwell, both the arm
        // angle and the fire direction fall back to idle/straight, and
        // the projectile is launched as a non-homing "no-target" shot.
        // The CROSSHAIR uses HIT_MARKER_DELAY_MS instead (slightly
        // longer), so visually the marker confirms an already-active
        // lock rather than triggering it. Applies to every weapon since
        // it's enforced here in WeaponSystem.
        const lockReady = !!target && (now - this.aimLockedAt) >= AIM_LOCK_DELAY_MS;
        this.lockedTarget = lockReady ? target : null;
        const desiredAngle = this.lockedTarget
            ? this._aimAngleTo(this.lockedTarget, player)
            : this._idleAngle(player);
        player.setAimAngle(desiredAngle);
        player.tickArmAim(step);

        // Fire decision — semi vs auto behave differently:
        //   semi: a click during cooldown is buffered until cooldown ends.
        //         Holding does NOT repeat-fire.
        //   auto: a click that lands while ready fires immediately. Continued
        //         hold past `autoFireHoldDelayMs` keeps firing at the cooldown
        //         rate. A *soft* click (release before the hold delay) fires
        //         exactly one shot — even if cooldown ends mid-hold.
        const w = player.weapon;
        // Heat dissipation — but only when the weapon is idle for longer
        // than `overheatIdleGraceMs`, OR during an active overheat lockout
        // (so the gun can always finish cooling and unlock). Short taps
        // and brief pauses between bursts therefore carry heat forward
        // instead of resetting, making spam-tap fire overheat like a
        // single sustained hold.
        if (w.overheatMaxShots) {
            const prev = this.heatLastTick || now;
            const dtMs = Math.max(0, now - prev);
            const decayPerSec = w.overheatDecayPerSec || (w.overheatMaxShots / 2.5);
            const graceMs = w.overheatIdleGraceMs || 0;
            const sinceLastShot = this.lastShotAt > 0 ? (now - this.lastShotAt) : Infinity;
            const inGrace = !this.overheated && sinceLastShot < graceMs;
            if (!inGrace) {
                this.heat = Math.max(0, this.heat - decayPerSec * (dtMs / 1000));
            }
            this.heatLastTick = now;
            const resumeAt = w.overheatResumeAt != null
                ? w.overheatResumeAt
                : w.overheatMaxShots * 0.25;
            if (this.overheated && this.heat <= resumeAt) this.overheated = false;
        } else {
            // Reset state when the equipped weapon doesn't overheat so it
            // doesn't carry over after a swap.
            if (this.heat !== 0 || this.overheated) {
                this.heat = 0;
                this.overheated = false;
            }
            this.heatLastTick = now;
        }
        // Vent smoke + flame from each barrel while overheated. Reuses the
        // same particle helpers the bazooka rocket uses for its trail.
        // Barrel positions are queried through the same transform as a
        // live shot so the puffs stay pinned to the gun muzzles even as
        // the arm swings. A punchy one-shot burst fires the instant the
        // weapon transitions to overheated, so the lockout reads clearly.
        if (this.overheated && w.overheatSmokeEmitEveryMs) {
            const offsets = w.barrelOffsets && w.barrelOffsets.length
                ? w.barrelOffsets
                : [null];
            const smokeScale = w.overheatSmokeScale != null ? w.overheatSmokeScale : 0.5;
            const fireScale  = w.overheatFireScale  != null ? w.overheatFireScale  : 0.4;
            const burstCount = Math.max(1, w.overheatSmokeBurstCount || 1);
            // Rising-edge detection for the one-shot initial burst — uses
            // overheatSmokeAt==0 as the sentinel "haven't emitted yet this
            // overheat cycle" (reset falls back to 0 whenever the weapon
            // cools below resumeAt, see the sibling branch below).
            const freshOverheat = this.overheatSmokeAt === 0;
            if (freshOverheat) {
                const burst = w.overheatInitialBurstScale != null
                    ? w.overheatInitialBurstScale
                    : 1.6;
                // One-shot overheat SFX. A non-zero `overheatSoundDelayMs`
                // parks it in the pending-sounds queue so it lands after
                // the post-fire ending clip has had time to play out;
                // zero/omitted plays immediately via `recentShots`.
                if (w.overheatSoundKey) {
                    const delay = w.overheatSoundDelayMs || 0;
                    const vol = w.overheatSoundVolume != null ? w.overheatSoundVolume : 0.4;
                    if (delay > 0) {
                        this.pendingSounds.push({
                            fireAt: now + delay,
                            soundKey: w.overheatSoundKey,
                            volume: vol
                        });
                    } else {
                        this.recentShots.push({
                            mode: 'one-shot',
                            soundKey: w.overheatSoundKey,
                            volume: vol
                        });
                    }
                }
                for (const off of offsets) {
                    const pos = player.getBarrelPosAndAim(camera.y, off);
                    if (!pos) continue;
                    particles.spawnSmokePuff(pos.x, pos.y, smokeScale * burst);
                    particles.spawnSmokePuff(pos.x + 6, pos.y - 4, smokeScale * burst * 0.8);
                    particles.spawnSmokePuff(pos.x - 6, pos.y + 4, smokeScale * burst * 0.8);
                    if (fireScale > 0) {
                        particles.spawnBulletFlame(pos.x, pos.y, fireScale * burst);
                        particles.spawnBulletFlame(pos.x + 4, pos.y - 2, fireScale * burst * 0.7);
                    }
                }
                this.overheatSmokeAt = now;
            } else if ((now - this.overheatSmokeAt) >= w.overheatSmokeEmitEveryMs) {
                this.overheatSmokeAt = now;
                for (const off of offsets) {
                    const pos = player.getBarrelPosAndAim(camera.y, off);
                    if (!pos) continue;
                    for (let i = 0; i < burstCount; i++) {
                        // Tiny position jitter so stacked puffs don't
                        // render as one flat sprite — reads as a roiling
                        // cloud instead of a single disc.
                        const jx = (Math.random() - 0.5) * 14;
                        const jy = (Math.random() - 0.5) * 10;
                        particles.spawnSmokePuff(pos.x + jx, pos.y + jy, smokeScale);
                        if (fireScale > 0 && i < 2) {
                            particles.spawnBulletFlame(pos.x + jx * 0.4, pos.y + jy * 0.4, fireScale);
                        }
                    }
                }
            }
        } else if (!this.overheated && this.overheatSmokeAt !== 0) {
            // Back to cool — arm the rising-edge sentinel for next cycle.
            this.overheatSmokeAt = 0;
        }
        // Sustained fire cycle — only runs for weapons that declare the
        // preFire/sustained/postFire trio. Other weapons (per-shot SFX) skip
        // this block entirely and fire like before.
        //
        //   idle   → spinup  : trigger pressed while not overheated. preFire
        //                      sound emitted. Shots blocked for preFireDelayMs.
        //   spinup → firing  : preFireDelayMs elapsed. sustained-start emitted.
        //                      Shots may fire at cadence.
        //   spinup → idle    : trigger released early. Silent (no postFire
        //                      since no round ever left the barrel).
        //   firing → idle    : trigger released OR overheat hit. sustained-stop
        //                      + postFire emitted via _endFireCycle.
        if (w.preFireSoundKey) {
            const wantFire = input.mousePressed && !this.overheated;
            if (this.fireCycle === 'idle') {
                if (wantFire) {
                    this.fireCycle = 'spinup';
                    this.fireCycleStartedAt = now;
                    this._lastCycleWeapon = w;
                    this.recentShots.push({
                        mode: 'one-shot',
                        soundKey: w.preFireSoundKey,
                        volume: w.preFireSoundVolume != null ? w.preFireSoundVolume : 0.4
                    });
                }
            } else if (this.fireCycle === 'spinup') {
                if (!wantFire) {
                    // Silent cancel — never reached firing, so no postFire.
                    this.fireCycle = 'idle';
                    this.fireCycleStartedAt = 0;
                    this._lastCycleWeapon = null;
                } else if ((now - this.fireCycleStartedAt) >= (w.preFireDelayMs || 0)) {
                    this.fireCycle = 'firing';
                    if (w.sustainedFireSoundKey) {
                        this.recentShots.push({
                            mode: 'sustained-start',
                            soundKey: w.sustainedFireSoundKey,
                            volume: w.sustainedFireSoundVolume != null ? w.sustainedFireSoundVolume : 0.4
                        });
                    }
                }
            } else if (this.fireCycle === 'firing') {
                if (!wantFire) this._endFireCycle();
            }
        }

        const cooldownReady = (now - this.lastShotAt) >= w.fireCooldownMs;
        let shouldFire = false;
        if (w.autoFire) {
            if (cooldownReady) {
                if (input.fireRequested) {
                    // Initial mousedown for this press.
                    input.fireRequested = false;
                    shouldFire = true;
                } else if (input.mousePressed
                        && (now - input.mouseDownAt) >= w.autoFireHoldDelayMs) {
                    // Continued hold past the tap-vs-hold threshold.
                    shouldFire = true;
                }
            }
        } else {
            if (cooldownReady && input.fireRequested) {
                input.fireRequested = false;
                shouldFire = true;
            }
        }
        // Overheat lockout — the fire request still clears (tap is consumed),
        // but no shot is fired until heat drops back under the resume line.
        if (shouldFire && w.overheatMaxShots && this.overheated) shouldFire = false;
        // Sustained-cycle gate: for preFire weapons, real rounds only leave
        // the barrel once the cycle is in the 'firing' state.
        if (shouldFire && w.preFireSoundKey && this.fireCycle !== 'firing') shouldFire = false;
        if (!shouldFire) return;
        this._fire(player, particles, camera.y);
        this.lastShotAt = now;
        if (w.overheatMaxShots) {
            this.heat = Math.min(w.overheatMaxShots, this.heat + 1);
            if (this.heat >= w.overheatMaxShots) {
                this.overheated = true;
                // Overheat mid-fire: end the cycle immediately so the
                // sustained loop stops and postFire plays.
                if (w.preFireSoundKey && this.fireCycle === 'firing') this._endFireCycle();
            }
        }
    }

    _fire(player, particles, cameraY) {
        const w = player.weapon;
        const target = this.lockedTarget;
        // Rockets always fire a single projectile — multi-barrel config is
        // ignored for `projectileKind === 'rocket'` (the bazooka branch).
        if (w.projectileKind === 'rocket' || !w.barrelOffsets || !w.barrelOffsets.length) {
            this._spawnShot(player, particles, cameraY, null, target);
            return;
        }
        // Multi-barrel salvo: fire the first barrel instantly, queue the
        // rest with their stagger. Each queued entry is drained in update()
        // by `_spawnShot`. Queuing (rather than a setTimeout) keeps the
        // game's pause / reset / shiftSchedule flow authoritative.
        const offsets = w.barrelOffsets;
        const stagger = w.barrelStaggerMs || 0;
        const now = performance.now();
        this._spawnShot(player, particles, cameraY, offsets[0], target);
        for (let i = 1; i < offsets.length; i++) {
            this.pendingShots.push({
                fireAt: now + i * stagger,
                barrelOffset: offsets[i],
                target
            });
        }
    }

    // Spawn one projectile from a specific barrel offset (null = default
    // single-barrel point from weapon config). Centralizes the pool pick,
    // muzzle FX, and per-shot SFX so both the immediate-fire path and the
    // drained-queue path emit bit-identical shots.
    _spawnShot(player, particles, cameraY, barrelOffset, target) {
        const w = player.weapon;
        const aim = player.getBarrelPosAndAim(cameraY, barrelOffset);
        if (!aim) return;
        if (w.projectileKind === 'rocket') {
            const slot = this.rocketPool.find(r => !r.active);
            if (!slot) return;
            slot.spawn(aim.x, aim.y, aim.dx, aim.dy, w, target);
            particles.spawnSmokePuff(aim.x, aim.y, 0.8);
            particles.spawnBulletFlame(aim.x, aim.y, 1.0);
        } else {
            const slot = this.pool.find(p => !p.active);
            if (!slot) return;
            slot.spawn(aim.x, aim.y, aim.dx, aim.dy, w, target);
            if (w.muzzleEffect === 'smoke') {
                particles.spawnSmokePuff(aim.x, aim.y, 0.4);
            } else {
                particles.spawnPlasmaImpact(aim.x, aim.y, 4, w.muzzleFlashHue);
            }
        }
        if (w.fireSoundKey) {
            this.recentShots.push({
                soundKey: w.fireSoundKey,
                volume:   w.fireSoundVolume || 0.4
            });
        }
    }

    // Splash-damage detonation for a rocket. Center is the rocket's
    // position — NOT the target's — so the blast reads where the
    // explosion happened, matching the visual FX. Every eligible enemy
    // inside `splashRadiusPx` dies in one shot and contributes its
    // points via the same `recentKills` path regular hits use.
    _detonateRocket(rocket, particles, bulletManager, kingBillManager, birdManager) {
        const w = rocket.weapon;
        const R2 = w.splashRadiusPx * w.splashRadiusPx;
        const ex = rocket.x, ey = rocket.y;
        // Bullets / missiles
        for (const b of bulletManager.pool) {
            if (!b.active) continue;
            if (b.kind === 'missile' && !w.canKillMissile)      continue;
            if (b.kind === 'normal'  && !w.canKillNormalBullet) continue;
            const dx = b.x - ex, dy = b.y - ey;
            if (dx * dx + dy * dy > R2) continue;
            const kind = b.kind;
            const points = kind === 'missile' ? w.pointsMissile : w.pointsNormal;
            particles.spawnPopup(b.x, b.y - 20, points);
            this.recentKills.push({ kind, points, x: b.x, y: b.y });
            b.active = false;
        }
        // KingBills
        if (w.canKillKingBill && kingBillManager) {
            for (const kb of kingBillManager.pool) {
                if (!kb.active) continue;
                const dx = kb.x - ex, dy = kb.y - ey;
                if (dx * dx + dy * dy > R2) continue;
                const points = w.pointsKingBill || 0;
                particles.spawnPopup(kb.x, kb.y - 20, points);
                this.recentKills.push({ kind: 'kingBill', points, x: kb.x, y: kb.y });
                kb.active = false;
            }
        }
        // Bird — same tumble the stomp/plasma kill path uses so the
        // player sees the familiar falling animation.
        if (w.canKillBird && birdManager
            && birdManager.bird.active
            && birdManager.bird.state === 'flying') {
            const bd = birdManager.bird;
            const dx = bd.x - ex, dy = bd.y - ey;
            if (dx * dx + dy * dy <= R2) {
                const points = w.pointsBird;
                particles.spawnPopup(bd.x, bd.y - 20, points);
                this.recentKills.push({ kind: 'bird', points, x: bd.x, y: bd.y });
                bd.state = 'falling';
                bd.fallVy = -140;
                bd.fallGravity = 900;
            }
        }
        // Visual FX — reuse the kill explosion then layer extras so the
        // bazooka blast reads bigger than a plasma kill.
        particles.spawnExplosion(ex, ey);
        particles.spawnSparkBurst(ex, ey, 18);
        for (let i = 0; i < 6; i++) {
            particles.spawnBulletFlame(
                ex + (Math.random() - 0.5) * 40,
                ey + (Math.random() - 0.5) * 40,
                1.4
            );
        }
        // Queue explosion SFX — same drain path as fire SFX, different
        // AudioPool key on the weaponAudio map.
        if (w.explosionSoundKey) {
            this.recentShots.push({
                soundKey: w.explosionSoundKey,
                volume:   w.explosionSoundVolume || 0.5
            });
        }
        // FUTURE: self-damage. When a player health system lands, check
        // (player.x, player.y + player.height/2) vs (ex, ey) against R2
        // and call player.takeDamage(w.splashPlayerDamage) here.
    }

    // Highest-priority active enemy this weapon can kill, in front of the
    // panda AND within the arm's reachable angle cone.
    //
    // Proximity override: if ANY reachable target is within
    // `ARM_AIM_PROXIMITY_PX` of the arm pivot, the closest one wins no
    // matter what kind it is — "thing in my face" beats tier priority.
    // Beyond that radius fall back to tiers:
    //   1. tracked missile    (red, actively homing)
    //   2. tracked king bill  (only if weapon.canKillKingBill)
    //   3. tracked normal bullet
    //   4. bird               (lowest of the live threats — also stomp-killable)
    //   5. retired missile    ┐ drifting-off projectiles the homing AI has
    //   6. retired king bill  │ given up on. Still physically on screen and
    //   7. retired normal     ┘ shootable, just lowest priority so the bird
    //                            (still actively hunting) gets cleared first.
    // Within a tier we pick the nearest. If nothing qualifies the arm
    // idles — a click then fires straight along the current aim.
    _pickTarget(player, bulletManager, kingBillManager, birdManager) {
        const w = player.weapon;
        const facingLeft = player.facing === 'left';
        const flip = facingLeft ? 1 : -1;
        const halfW = player.width / 2;
        const pivotX = facingLeft
            ? player.x - halfW + w.armPivotXFrac * player.width
            : player.x + halfW - w.armPivotXFrac * player.width;
        const pivotY = player.y + w.armPivotYFrac * player.height;
        // Per-weapon lock range — anything beyond this distance from the
        // arm pivot is invisible to auto-aim. A weapon can still HIT a
        // distant enemy if the projectile happens to fly through it
        // (contact is resolved separately), this just stops the gun
        // from locking on and tracking. `maxLockRangePx` left unset
        // (or <= 0) means unlimited, matching existing behavior.
        const lockR = w.maxLockRangePx > 0 ? w.maxLockRangePx : Infinity;
        const lockR2 = lockR * lockR;
        // distSq if the target is reachable, otherwise null.
        const evaluate = (t) => {
            const dxBody = t.x - player.x;
            if (facingLeft  && dxBody > 0) return null;
            if (!facingLeft && dxBody < 0) return null;
            const pdx = t.x - pivotX;
            const pdy = t.y - pivotY;
            const angleDeg = Math.atan2(-pdy, -flip * pdx) * 180 / Math.PI;
            if (angleDeg >  w.angleUpDeg)   return null;
            if (angleDeg < -w.angleDownDeg) return null;
            const d2 = pdx * pdx + pdy * pdy;
            if (d2 > lockR2) return null;
            return d2;
        };
        // Track the single closest reachable target across ALL kinds for
        // the proximity override, alongside per-tier winners (tracked vs.
        // retired split so retired slots under bird in the fallback).
        let closest = null, closestD2 = Infinity;
        const considerClosest = (t, d2) => {
            if (d2 < closestD2) { closestD2 = d2; closest = t; }
        };
        let missile        = null, missileD2        = Infinity;
        let missileRetired = null, missileRetiredD2 = Infinity;
        let normal         = null, normalD2         = Infinity;
        let normalRetired  = null, normalRetiredD2  = Infinity;
        for (const b of bulletManager.pool) {
            if (!b.active) continue;
            if (b.kind === 'missile' && !w.canKillMissile)      continue;
            if (b.kind === 'normal'  && !w.canKillNormalBullet) continue;
            const d2 = evaluate(b);
            if (d2 == null) continue;
            const retired = !!(b.isRetired && b.isRetired());
            if (b.kind === 'missile') {
                if (retired) {
                    if (d2 < missileRetiredD2) { missileRetiredD2 = d2; missileRetired = b; }
                } else {
                    if (d2 < missileD2) { missileD2 = d2; missile = b; }
                }
            } else {
                if (retired) {
                    if (d2 < normalRetiredD2) { normalRetiredD2 = d2; normalRetired = b; }
                } else {
                    if (d2 < normalD2) { normalD2 = d2; normal = b; }
                }
            }
            considerClosest(b, d2);
        }
        let kingBill        = null, kingBillD2        = Infinity;
        let kingBillRetired = null, kingBillRetiredD2 = Infinity;
        if (w.canKillKingBill && kingBillManager) {
            for (const kb of kingBillManager.pool) {
                if (!kb.active) continue;
                const d2 = evaluate(kb);
                if (d2 == null) continue;
                if (kb.isRetired()) {
                    if (d2 < kingBillRetiredD2) { kingBillRetiredD2 = d2; kingBillRetired = kb; }
                } else {
                    if (d2 < kingBillD2) { kingBillD2 = d2; kingBill = kb; }
                }
                considerClosest(kb, d2);
            }
        }
        let bird = null, birdD2 = Infinity;
        if (w.canKillBird && birdManager
            && birdManager.bird.active
            && birdManager.bird.state === 'flying') {
            const d2 = evaluate(birdManager.bird);
            if (d2 != null) {
                bird = birdManager.bird;
                birdD2 = d2;
                considerClosest(birdManager.bird, d2);
            }
        }
        // Proximity override: anything in "panic range" takes priority —
        // retired projectiles included, since a drifting missile at
        // point-blank range is still a legitimate shootable.
        const proxPx = ARM_AIM_PROXIMITY_PX;
        if (closest && closestD2 <= proxPx * proxPx) return closest;
        // Tier fallback with distance-gap cascade. Walk top-down: the
        // first non-null slot seeds `best`; any later (lower-tier) slot
        // steals the lock only if it's at least ARM_AIM_TIER_OVERRIDE_PX
        // closer to the pivot than the current best. Using sqrt here (vs
        // comparing d²) keeps the gap expressible in real pixels — the
        // constant means what it says.
        //
        // Bird is excluded from this cascade because it isn't a "real"
        // enemy in the threat sense — it's a bonus stomp/score target.
        // We don't want a close bird stealing a gun-lock from a
        // further-away missile or bullet. Bird is handled as a
        // last-resort fallback after the cascade runs dry.
        const tiers = [
            { t: missile,         d2: missileD2 },
            { t: kingBill,        d2: kingBillD2 },
            { t: normal,          d2: normalD2 },
            { t: missileRetired,  d2: missileRetiredD2 },
            { t: kingBillRetired, d2: kingBillRetiredD2 },
            { t: normalRetired,   d2: normalRetiredD2 }
        ];
        const gap = ARM_AIM_TIER_OVERRIDE_PX;
        let best = null, bestDist = Infinity;
        for (const c of tiers) {
            if (!c.t) continue;
            const dist = Math.sqrt(c.d2);
            if (!best) {
                best = c.t; bestDist = dist;
            } else if (dist + gap < bestDist) {
                best = c.t; bestDist = dist;
            }
        }
        // No enemy in the cone → bird is the last-resort target so the
        // arm still has something to track when the sky is clear.
        return best || bird;
    }

    // Idle angle (radians) when no target is auto-aimed at: a slow up/down
    // sine bob, plus a tilt-upward proportional to the panda's upward speed
    // so jumping reads as "carrying the gun's momentum". Falling adds no
    // tilt — only rising does. Clamped to the weapon's reach.
    _idleAngle(player) {
        const w = player.weapon;
        const t = (performance.now() % w.idleBobPeriodMs) / w.idleBobPeriodMs;
        const bobDeg = Math.sin(t * Math.PI * 2) * w.idleBobAmplitudeDeg;
        const upwardSpeed = Math.max(0, -player.vy);   // 0 when falling
        const tiltDeg = Math.min(upwardSpeed * w.jumpTiltVyScale, w.jumpTiltMaxDeg);
        const angleDeg = clamp(bobDeg + tiltDeg, -w.angleDownDeg, w.angleUpDeg);
        return angleDeg * Math.PI / 180;
    }

    // Angle (radians) to point the gun at `target`, clamped to weapon limits.
    // Pivot uses the facing-aware fraction WITHOUT tuck (tuck depends on the
    // angle we're trying to compute — circular). Tuck offset is small enough
    // that this approximation lands within a pixel or two of the visible pivot.
    _aimAngleTo(target, player) {
        const w = player.weapon;
        const facingLeft = player.facing === 'left';
        const flip = facingLeft ? 1 : -1;
        const halfW = player.width / 2;
        const pivotX = facingLeft
            ? player.x - halfW + w.armPivotXFrac * player.width
            : player.x + halfW - w.armPivotXFrac * player.width;
        const pivotY = player.y + w.armPivotYFrac * player.height;
        const dx = target.x - pivotX;
        const dy = target.y - pivotY;
        // Aim direction in screen space is (-flip*cosA, -sinA). Solve for A:
        const angleRad = Math.atan2(-dy, -flip * dx);
        const angleDeg = angleRad * 180 / Math.PI;
        const clampedDeg = clamp(angleDeg, -w.angleDownDeg, w.angleUpDeg);
        return clampedDeg * Math.PI / 180;
    }

    _resolveHits(bulletManager, kingBillManager, birdManager, particles) {
        for (const shot of this.pool) {
            if (!shot.active) continue;
            const w = shot.weapon;
            let hit = null, hitKind = null;
            const hitPad = w.projectileHitRadius || 0;   // weapon-defined forgiveness
            // Bullets / missiles
            for (const b of bulletManager.pool) {
                if (!b.active) continue;
                if (b.kind === 'missile' && !w.canKillMissile)      continue;
                if (b.kind === 'normal'  && !w.canKillNormalBullet) continue;
                const r = Math.min(b.width, b.height) * 0.4 + hitPad;
                if (!shot.intersectsCircle(b.x, b.y, r)) continue;
                hit = b; hitKind = b.kind;
                break;
            }
            // King Bill (only if the weapon is permitted). Retired ones are
            // also killable — they're still physically on screen and can be
            // shot down for the kill popup, they just don't get auto-targeted.
            if (!hit && w.canKillKingBill && kingBillManager) {
                for (const kb of kingBillManager.pool) {
                    if (!kb.active) continue;
                    const r = Math.min(kb.width, kb.height) * 0.4 + hitPad;
                    if (shot.intersectsCircle(kb.x, kb.y, r)) {
                        hit = kb; hitKind = 'kingBill';
                        break;
                    }
                }
            }
            // Bird (lowest priority — only check if no bullet/missile/kingbill hit)
            if (!hit && w.canKillBird && birdManager
                && birdManager.bird.active
                && birdManager.bird.state === 'flying') {
                const bird = birdManager.bird;
                // Match the AABB-derived radius used by Bird.overlaps
                // (width*0.38, height*0.35) — use the smaller for circle.
                const r = Math.min(bird.width * 0.38, bird.height * 0.35) + hitPad;
                if (shot.intersectsCircle(bird.x, bird.y, r)) {
                    hit = bird; hitKind = 'bird';
                }
            }
            if (!hit) continue;

            const muzzleHue = w.muzzleFlashHue;
            // Track cumulative hits on bullets/missiles. Birds + normals die
            // in 1 hit; missiles need weapon.hitsToKillMissile.
            const isBulletKind = (hitKind !== 'bird');
            if (isBulletKind) {
                hit.hitCount += 1;
                // Per-kind hit budget. Normals default to 1 unless the
                // weapon explicitly sets a higher count (SMG = 2, reflecting
                // lighter rounds).
                const required = (hitKind === 'missile')  ? w.hitsToKillMissile
                               : (hitKind === 'kingBill') ? w.hitsToKillKingBill
                               : (hitKind === 'normal')   ? (w.hitsToKillNormal || 1)
                               : 1;
                if (hit.hitCount < required) {
                    // Damaged but still flying — visually distinct from kill.
                    // Smoke weapons (M16): two small puffs reading as impact
                    // dust. Sparkle weapons (raygun): tinted sparkle + leak.
                    if (w.muzzleEffect === 'smoke') {
                        particles.spawnSmokePuff(hit.x, hit.y, 0.6);
                        particles.spawnSmokePuff(hit.x + 4, hit.y - 4, 0.4);
                    } else {
                        particles.spawnPlasmaImpact(hit.x, hit.y, 6, muzzleHue);
                        particles.spawnSmokePuff(hit.x, hit.y, 0.5);
                    }
                    // Brief homing stun so the missile visibly reels from the
                    // hit before snapping back onto the panda.
                    hit.knockStunnedUntil = performance.now() + 220;
                    shot.active = false;
                    continue;
                }
            }

            const points = hitKind === 'missile'  ? w.pointsMissile
                         : hitKind === 'kingBill' ? (w.pointsKingBill || 0)
                         : hitKind === 'bird'     ? w.pointsBird
                         :                          w.pointsNormal;
            particles.spawnExplosion(hit.x, hit.y);
            // Skip the extra sparkle splash for smoke weapons — the warm
            // explosion already reads as the kill effect.
            if (w.muzzleEffect !== 'smoke') {
                particles.spawnPlasmaImpact(hit.x, hit.y, 10, muzzleHue);
            }
            particles.spawnPopup(hit.x, hit.y - 20, points);
            if (hitKind === 'bird') {
                // Match the stomp tumble: bird arcs up briefly then falls.
                hit.state = 'falling';
                hit.fallVy = -140;
                hit.fallGravity = 900;
            } else {
                hit.active = false;
            }
            this.recentKills.push({ kind: hitKind, points, x: hit.x, y: hit.y });
            shot.active = false;
        }
    }

    render(ctx, cameraY) {
        for (const p of this.pool) if (p.active) p.render(ctx, cameraY);
        // Rockets are image-based — look up the sprite from assets by the
        // weapon's rocketSpriteKey. Different rocket-kind weapons (future
        // launchers) can ship their own projectile art without a code change.
        for (const r of this.rocketPool) {
            if (!r.active) continue;
            const key = r.weapon && r.weapon.rocketSpriteKey;
            const img = key && this.assets ? this.assets.images[key] : null;
            r.render(ctx, cameraY, img);
        }
    }

    // Draws a red crosshair on the currently-aimed target once the aim has
    // dwelled on it for at least HIT_MARKER_DELAY_MS. Opt-in via the
    // Settings overlay — Game passes `show` reflecting the toggle state.
    //
    // Visibility notes:
    //   1. Per-target radius: ring sizes itself from the target sprite so a
    //      140px KingBill gets a ~85px ring while a 70px bullet gets ~46px.
    //      Future enemies pick up the right size automatically.
    //   2. Dark halo: each stroke is painted twice — a thicker ink stroke
    //      first, then the red on top. That dark outline keeps the ring
    //      visible on red/orange targets (missile, bird) where a pure-red
    //      crosshair would otherwise disappear.
    //   3. Pulse: subtle sinusoidal alpha wobble so the lock reads as
    //      "live" even when the halo isn't enough to pop against the target.
    renderHitMarker(ctx, cameraY, show) {
        if (!show) return;
        const t = this.aimTarget;
        if (!t || !t.active) return;
        const now = performance.now();
        const dwell = now - this.aimLockedAt;
        if (dwell < HIT_MARKER_DELAY_MS) return;
        // 120ms grow-in after the delay hits — ring shrinks onto the target
        // rather than popping in at final size.
        const grow = clamp((dwell - HIT_MARKER_DELAY_MS) / 120, 0, 1);
        // Hug the sprite: radius = half the longer sprite side + a small
        // constant margin so the ring sits just outside the silhouette.
        const spriteExtent = Math.max(t.width || 32, t.height || 32) * 0.55;
        const baseR = spriteExtent + 8;
        const r = baseR * (1 + (1 - grow) * 0.3);     // starts ~30% larger
        // Subtle pulse (±8% alpha, ~1.75 Hz).
        const pulse = 0.92 + Math.sin(now / 180) * 0.08;
        const alpha = (0.35 + grow * 0.55) * pulse;
        // Tick geometry scales with the ring so KingBill's longer ticks read
        // as "heavy lock" while small targets stay tidy.
        const tickOuter = r + Math.max(6, r * 0.22);
        const tickInner = r + 1;

        const screenY = t.y - cameraY;
        ctx.save();
        ctx.translate(t.x, screenY);
        ctx.globalAlpha = alpha;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        // Build ring + ticks once, stroke twice (dark halo under, red on top).
        const buildPath = () => {
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.moveTo( tickInner, 0); ctx.lineTo( tickOuter, 0);
            ctx.moveTo(-tickInner, 0); ctx.lineTo(-tickOuter, 0);
            ctx.moveTo(0,  tickInner); ctx.lineTo(0,  tickOuter);
            ctx.moveTo(0, -tickInner); ctx.lineTo(0, -tickOuter);
        };
        // Line widths also scale slightly with radius so big KingBill ring
        // doesn't look anemic; clamped so small targets don't get chunky.
        const redWidth  = clamp(r * 0.055, 2.2, 4.0);
        const haloWidth = redWidth + 2.6;
        buildPath();
        ctx.strokeStyle = '#1a1130';
        ctx.lineWidth = haloWidth;
        ctx.stroke();
        buildPath();
        ctx.strokeStyle = '#ff3344';
        ctx.lineWidth = redWidth;
        ctx.stroke();

        // Center dot, also halo'd.
        const dotR = clamp(r * 0.05, 2, 4);
        ctx.fillStyle = '#1a1130';
        ctx.beginPath(); ctx.arc(0, 0, dotR + 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#ff3344';
        ctx.beginPath(); ctx.arc(0, 0, dotR,       0, Math.PI * 2); ctx.fill();

        ctx.restore();
    }
}


// ============================================================
// CloudManager — spawns, culls, difficulty curve, collision
// ============================================================

class CloudManager {
    constructor(cloudImages, darkCloudImages, difficulty) {
        this.cloudImages = cloudImages;
        this.darkCloudImages = darkCloudImages;
        this.clouds = [];
        this.viewportW = 0;
        this.viewportH = 0;
        this.difficulty = difficulty;   // { stormMult, ... }
        // Columns where a storm cloud must NOT spawn. Each zone is
        // { x, halfWidth, yMin, yMax }. Set by the Game each frame while a
        // jetpack pickup (or other no-storm item) exists so the column the
        // player flies through after pickup can't instantly kill them.
        this.forbiddenStormZones = [];
        // Optional — wired by the Game after construction. Null during the
        // pre-play `reset` pre-spawn (we skip coin rolls then anyway).
        this.coinManager = null;
    }

    setCoinManager(cm) { this.coinManager = cm; }

    setForbiddenStormZones(zones) {
        this.forbiddenStormZones = zones || [];
    }

    _inForbiddenStormZone(x, y) {
        for (const z of this.forbiddenStormZones) {
            if (y < z.yMin || y > z.yMax) continue;
            if (Math.abs(x - z.x) < z.halfWidth) return true;
        }
        return false;
    }

    setViewport(w, h) {
        const oldW = this.viewportW;
        this.viewportW = w;
        this.viewportH = h;
        if (oldW > 0 && oldW !== w) {
            const factor = w / oldW;
            for (const c of this.clouds) {
                c.x *= factor;
                const halfW = c.width / 2;
                c.x = clamp(c.x, halfW, w - halfW);
                if (c.moves) {
                    c.minX = halfW;
                    c.maxX = w - halfW;
                }
            }
        }
    }

    reset(playerFeetY) {
        this.clouds = [];
        // Starting cloud is deliberately large so the first bounce is forgiving.
        const startWidth = this._widthRangeAt(0).max;
        // The starting cloud's hitboxTop must be exactly playerFeetY so the panda
        // doesn't fall through on frame 1.
        const startY = playerFeetY - startWidth / (this.cloudImages[0].naturalWidth / this.cloudImages[0].naturalHeight) * CLOUD_HITBOX_DEPTH;
        const startCloud = new Cloud(this.viewportW / 2, startY, startWidth, choice(this.cloudImages));
        // Recompute precise y using the real cloud's height
        startCloud.y = playerFeetY - startCloud.height * CLOUD_HITBOX_DEPTH;
        this.clouds.push(startCloud);

        // Pre-spawn a few reachable clouds upward. Kept small so the opening
        // view isn't cluttered — the on-demand spawner tops it up once we climb.
        let lastCloud = startCloud;
        for (let i = 0; i < 3; i++) {
            const yNew = lastCloud.y - this._gapAt(0);
            this._spawnAt(yNew, 0, lastCloud);
            lastCloud = this.clouds[this.clouds.length - 1];
        }
    }

    update(step, cameraY, ascent) {
        // Spawn upward until topmost is one viewport above the camera
        if (this.clouds.length === 0) return;
        let topmost = this.clouds[0];
        for (const c of this.clouds) if (c.y < topmost.y) topmost = c;
        const spawnLimitY = cameraY - this.viewportH;
        let safety = 80;
        while (topmost.y > spawnLimitY && safety-- > 0) {
            const yNew = topmost.y - this._gapAt(ascent);
            this._spawnAt(yNew, ascent, topmost);
            topmost = this.clouds[this.clouds.length - 1];
        }

        for (const c of this.clouds) c.update(step);

        // Cull clouds well below viewport, plus any vanish-completed clouds
        const cullY = cameraY + this.viewportH + 60;
        this.clouds = this.clouds.filter(c => c.y <= cullY && !c.isGone());
    }

    render(ctx, cameraY, nightFactor = 0) {
        for (const c of this.clouds) c.render(ctx, cameraY, this.viewportH, nightFactor);
    }

    // Returns landed cloud or null. Swept-segment collision on player's feet.
    // The panda is clamped to the viewport in Player.update, so no wrap-ghost
    // position fallbacks are needed.
    checkCollision(player) {
        if (player.vy <= 0) return null;
        const halfPW = player.width / 2;
        const footLeft = player.x - halfPW + FOOT_INSET;
        const footRight = player.x + halfPW - FOOT_INSET;
        for (const c of this.clouds) {
            if (c.used) continue;
            if (player.prevFeetY > c.hitboxTop) continue;
            if (player.feetY < c.hitboxTop) continue;
            if (footRight >= c.left && footLeft <= c.right) return c;
        }
        return null;
    }

    // Hazard clouds (storms) kill on ANY touch — sides and bottom included,
    // not only on top-down landings. AABB against the cloud's fluff area, with
    // slight insets so transparent sprite corners don't trigger false deaths.
    checkHazardCollision(player) {
        const halfPW = player.width / 2;
        const pLeft  = player.x - halfPW + FOOT_INSET;
        const pRight = player.x + halfPW - FOOT_INSET;
        const pTop   = player.y;
        const pBot   = player.y + player.height;
        for (const c of this.clouds) {
            if (c.used || !c.isHazard) continue;
            const cLeft  = c.left  + c.width  * 0.08;
            const cRight = c.right - c.width  * 0.08;
            const cTop   = c.y     + c.height * CLOUD_HITBOX_DEPTH;
            const cBot   = c.y     + c.height * (1 - CLOUD_HITBOX_DEPTH);
            if (pRight > cLeft && pLeft < cRight && pBot > cTop && pTop < cBot) return c;
        }
        return null;
    }

    _spawnAt(y, ascent, prevCloud) {
        const range = this._widthRangeAt(ascent);
        // Per-cloud random width so the row has visible size variance.
        const wNormal = randRange(range.min, range.max);
        const halfWNormal = wNormal / 2;
        // Cap the horizontal distance between consecutive clouds so the panda
        // never has to dart across the whole viewport to reach the next one.
        const reachable = this.viewportW * 0.45;
        let minX = halfWNormal;
        let maxX = this.viewportW - halfWNormal;
        if (prevCloud) {
            minX = Math.max(minX, prevCloud.x - reachable);
            maxX = Math.min(maxX, prevCloud.x + reachable);
            // On very narrow viewports the clamped range may invert — fall back
            // to the full bounds so we always have a valid spawn position.
            if (maxX < minX) { minX = halfWNormal; maxX = this.viewportW - halfWNormal; }
        }
        const x = randRange(minX, maxX);

        // Normal cloud is ALWAYS spawned — guarantees a continuous climb path.
        const normalCloud = new Cloud(x, y, wNormal, choice(this.cloudImages));
        this.clouds.push(normalCloud);

        // Coin rolls — independent per-row so one row can fire multiple
        // shapes. A per-row budget caps total spawns so overlapping rolls
        // (arc + column + above) can't pile 10+ coins in a tight gap.
        // Skipped if no manager is wired (pre-play prime spawn).
        if (this.coinManager) {
            this.coinManager.beginRow(COIN_MAX_PER_ROW);
            if (Math.random() < COIN_SPAWN_CHANCES.aboveCloud) {
                this.coinManager.spawnAbove(normalCloud);
            }
            if (prevCloud && Math.random() < COIN_SPAWN_CHANCES.arcTrail) {
                this.coinManager.spawnArcTrail(prevCloud, normalCloud);
            }
            if (prevCloud && Math.random() < COIN_SPAWN_CHANCES.column) {
                this.coinManager.spawnColumn(prevCloud, normalCloud);
            }
            if (prevCloud && Math.random() < COIN_SPAWN_CHANCES.scatter) {
                this.coinManager.spawnScatter(prevCloud, normalCloud, this.viewportW);
            }
        }

        // Storm cloud is an ADDITIONAL spawn at the same altitude, placed far
        // enough from both the just-spawned normal cloud and the previous cloud
        // that the player can't accidentally drift onto it on the natural arc.
        if (!this.darkCloudImages || this.darkCloudImages.length === 0) return;
        const stormChance = this._stormChanceAt(ascent);
        if (Math.random() >= stormChance) return;

        // Storm rolls its own width independently so it isn't a size-twin of
        // its neighbor. Spacing scales with the LARGER of the two so a big
        // storm next to a small normal cloud is still safely separated.
        const wStorm = randRange(range.min, range.max);
        const halfWStorm = wStorm / 2;
        const minStormDist = Math.max(wNormal, wStorm) * 1.8 + 40;

        // Decide upfront whether this storm will be a moving variant — that
        // affects placement (moving storms get routed to the side with more
        // room so they have a meaningful sweep).
        const willMove = Math.random() < this._movingChanceAt(ascent);

        let stormX = null;
        if (willMove) {
            stormX = this._placeMovingX(normalCloud, wStorm, minStormDist);
            // Moving storm picks one side based on room — reject outright if
            // that one-shot pick landed in a forbidden zone (e.g. directly
            // above an active jetpack pickup). Cloud row still gets its
            // normal cloud for path continuity, just no storm this row.
            if (stormX !== null && this._inForbiddenStormZone(stormX, y)) {
                stormX = null;
            }
        } else {
            for (let attempt = 0; attempt < 12; attempt++) {
                const candidate = randRange(halfWStorm, this.viewportW - halfWStorm);
                if (Math.abs(candidate - normalCloud.x) < minStormDist) continue;
                if (prevCloud && Math.abs(candidate - prevCloud.x) < minStormDist) continue;
                if (this._inForbiddenStormZone(candidate, y)) continue;
                stormX = candidate;
                break;
            }
        }
        if (stormX === null) return;   // no safe slot this row — skip the storm

        const storm = new StormCloud(stormX, y, wStorm, choice(this.darkCloudImages));
        this.clouds.push(storm);
        if (willMove) this._makeMoving(storm, [normalCloud], ascent);
    }

    // Wire a cloud as a moving cloud. Generic on purpose — works for storm
    // clouds today and for normal clouds later (same motion fields + helper).
    _makeMoving(cloud, neighbors, ascent) {
        const speed = this._movingSpeedAt(ascent);
        if (speed <= 0) return;     // difficulty has movingSpeedCap 0 (Easy)
        cloud.moves = true;
        cloud.vx = (Math.random() < 0.5 ? -1 : 1) * speed;
        cloud.minX = cloud.width / 2;
        cloud.maxX = this.viewportW - cloud.width / 2;
        cloud._rowNeighbors = neighbors ? neighbors.slice() : [];
        // Bidirectional: each neighbor tracks this one too, so if we ever
        // spawn two moving clouds at the same row they'll bounce off each
        // other cleanly (future-proof for moving normal clouds).
        for (const n of cloud._rowNeighbors) {
            if (!n._rowNeighbors) n._rowNeighbors = [];
            n._rowNeighbors.push(cloud);
        }
    }

    // Pick an x on the side of `paired` with more room (edge ↔ paired ± minDist).
    // Returns null if neither side has room for a meaningful sweep.
    _placeMovingX(paired, widthSelf, minDist) {
        const halfSelf = widthSelf / 2;
        const leftHi  = paired.x - minDist;                  // right edge of left strip
        const rightLo = paired.x + minDist;                  // left edge of right strip
        const leftRoom  = leftHi - halfSelf;                  // width of usable left strip
        const rightRoom = (this.viewportW - halfSelf) - rightLo;
        if (leftRoom <= 0 && rightRoom <= 0) return null;
        const pickLeft = leftRoom > 0 && (rightRoom <= 0 || leftRoom > rightRoom);
        if (pickLeft) return randRange(halfSelf, leftHi);
        return randRange(rightLo, this.viewportW - halfSelf);
    }

    _movingChanceAt(alt) {
        const d = this.difficulty;
        if (!d) return 0;
        return lerp(d.movingStormChanceMin, d.movingStormChanceMax, smoothstep(2000, 15000, alt));
    }

    _movingSpeedAt(alt) {
        const cap = this.difficulty ? this.difficulty.movingSpeedCap : 120;
        if (cap <= 0) return 0;
        const base = 50;
        const bonus = lerp(0, cap - base, smoothstep(1500, 15000, alt));
        return Math.min(base + bonus, cap);
    }

    _stormChanceAt(alt) {
        if (alt < 2000) return 0;
        let base;
        if (alt < 5000) base = lerp(0, 0.10, (alt - 2000) / 3000);
        else            base = lerp(0.10, 0.22, smoothstep(5000, 15000, alt));
        const scaled = base * (this.difficulty ? this.difficulty.stormMult : 1);
        return Math.min(scaled, 0.28);
    }

    _gapAt(alt) {
        // Jump apex is ~484 px, so gaps can grow much bigger than before.
        const gap = alt < 1500
            ? lerp(180, 230, alt / 1500)
            : lerp(230, 380, smoothstep(1500, 15000, alt));
        return gap;
    }

    // Altitude-driven [min, max] width range. Callers draw randomly per cloud
    // so each row has visible size variance. Difficulty scales both bounds.
    _widthRangeAt(alt) {
        // Normal-difficulty curve:
        //   alt 0      → min 130, max 210   (80 px spread — clearly varied)
        //   alt 20000+ → min 100, max 150   (both floor + ceiling shrink)
        // The range always stays 50+ px wide so no altitude looks uniform.
        const t = alt < 1500
            ? alt / 1500 * 0.25          // gentle slope during onboarding
            : 0.25 + 0.75 * smoothstep(1500, 20000, alt);
        let min = lerp(130, 100, t);
        let max = lerp(210, 150, t);

        const mult = this.difficulty ? this.difficulty.cloudWidthMult : 1;
        min *= mult;
        max *= mult;

        // Don't let clouds eat the whole viewport on small screens.
        const maxByVp = this.viewportW * 0.42;
        if (max > maxByVp) max = maxByVp;
        if (min > max) min = max;
        return { min, max };
    }
}


// ============================================================
// Camera — soft lerp + hard rail, never scrolls down
// ============================================================

class Camera {
    constructor() {
        this.y = 0;
        this.startY = 0;
        this.viewportH = 0;
    }

    setViewport(h) { this.viewportH = h; }

    reset(initialY) {
        this.y = initialY;
        this.startY = initialY;
    }

    follow(playerY, step) {
        const hardLimit = this.y + this.viewportH * CAMERA_CFG.hardThreshold;
        const softLimit = this.y + this.viewportH * CAMERA_CFG.softThreshold;

        let newY = this.y;
        if (playerY < hardLimit) {
            newY = playerY - this.viewportH * CAMERA_CFG.hardThreshold;
        } else if (playerY < softLimit) {
            const target = playerY - this.viewportH * CAMERA_CFG.softThreshold;
            newY = this.y + (target - this.y) * easeStep(CAMERA_CFG.ease, step);
        }
        if (newY < this.y) this.y = newY;  // never scroll down
    }

    get ascent() { return Math.max(0, this.startY - this.y); }
}


// ============================================================
// ParticleSystem — pooled +score popups AND star sparkles
// ============================================================

class ParticleSystem {
    constructor() {
        this.popupPool = [];
        for (let i = 0; i < 24; i++) {
            this.popupPool.push({ active: false, x: 0, y: 0, vy: 0, life: 0, maxLife: 0, value: 10 });
        }
        this.sparkPool = [];
        for (let i = 0; i < 96; i++) {
            this.sparkPool.push({
                active: false, x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 0, size: 0, rot: 0, rotSpeed: 0, hue: 0
            });
        }
        this.smokePool = [];
        for (let i = 0; i < 64; i++) {
            this.smokePool.push({
                active: false, x: 0, y: 0, vx: 0, vy: 0,
                life: 0, maxLife: 0, r0: 0, r1: 0, isFire: false
            });
        }
    }

    spawnPopup(x, y, value = 10, color = null, fontPx = 30, text = null) {
        const p = this.popupPool.find(p => !p.active);
        if (!p) return;
        p.active = true;
        p.x = x; p.y = y;
        p.vy = -1.4;
        p.life = 0;
        p.maxLife = 50;
        p.value = value;
        // `color` is the fill; stroke stays the dark outline. Null = default
        // cream fill used for cloud/bullet score popups. Coin pickups pass gold.
        p.color = color;
        // Per-popup font size — smaller popups (like coin +1s) pass 18px.
        p.fontPx = fontPx;
        // `text` overrides the default '+value' rendering. Used for FX
        // popups like "MISSED" where the numeric value isn't meaningful.
        p.text = text;
    }

    spawnSparkBurst(x, y, count = 10) {
        for (let i = 0; i < count; i++) {
            const p = this.sparkPool.find(s => !s.active);
            if (!p) return;
            p.active = true;
            p.x = x; p.y = y;
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.6 + Math.random() * 3.4;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 1.2;   // upward bias
            p.life = 0;
            p.maxLife = 28 + Math.random() * 22;    // ~0.47-0.83s
            p.size = 5 + Math.random() * 7;
            p.rot = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 0.35;
            // Slight hue variety: pale yellow → gold
            p.hue = 44 + Math.random() * 14;
        }
    }

    spawnSmokePuff(x, y, scale = 1) {
        const p = this.smokePool.find(s => !s.active);
        if (!p) return;
        p.active = true;
        p.isFire = false;
        p.x = x; p.y = y;
        // Drift scales sub-linearly with size — keeps big puffs from drifting
        // wildly far (which made the King Bill tail shoot off the screen).
        p.vx = (Math.random() - 0.5) * 0.6 * Math.sqrt(scale);
        p.vy = (-0.3 - Math.random() * 0.3) * Math.sqrt(scale);
        p.life = 0;
        // Lifetime is independent of scale now — bigger puffs fade in the same
        // time as small ones, so the trail length stays bounded even when the
        // emission point is huge.
        p.maxLife = 28 + Math.random() * 12;   // ~470-670ms
        p.r0 = 9  * scale;
        p.r1 = 22 * scale;
    }

    // Short, hot fire core at a bullet's tail. Lives briefly, sits roughly
    // in place — the bullet moves forward through it and leaves the grey
    // smoke (`spawnSmokePuff`) hanging behind. Together they read like a
    // rocket exhaust: bright fire near the cannon, smoke trailing.
    spawnBulletFlame(x, y, scale = 1) {
        const p = this.smokePool.find(s => !s.active);
        if (!p) return;
        p.active = true;
        p.isFire = true;
        p.x = x; p.y = y;
        // Tiny isotropic drift — flame doesn't shoot away like jetpack thrust;
        // the bullet is moving, not the flame.
        p.vx = (Math.random() - 0.5) * 0.5 * Math.sqrt(scale);
        p.vy = (Math.random() - 0.5) * 0.5 * Math.sqrt(scale);
        p.life = 0;
        p.maxLife = 12 + Math.random() * 8;     // ~200-330ms — fades fast
        // Smaller than the smoke puff at the same scale so the grey envelopes
        // the fire core. Normal bullet: r1=11 (vs smoke r1=22).
        p.r0 = 5  * scale;
        p.r1 = 11 * scale;
    }

    // Short-lived warm flame particle for jetpack exhaust. NOT a star —
    // shares the smoke pool so _renderSmoke can draw it as a circle/gradient.
    spawnJetpackFlame(x, y) {
        const p = this.smokePool.find(s => !s.active);
        if (!p) return;
        p.active = true;
        p.isFire = true;
        p.x = x + (Math.random() - 0.5) * 4;
        p.y = y;
        p.vx = (Math.random() - 0.5) * 0.8;
        p.vy = 1.6 + Math.random() * 1.4;   // downward ejection (thrust goes UP, flames go DOWN)
        p.life = 0;
        p.maxLife = 14 + Math.random() * 8; // ~230-360ms (short — flames fade fast)
        p.r0 = 3;
        p.r1 = 10;
    }

    // Grey smoke at the jetpack exhaust. Drifts downward a touch then slows.
    spawnJetpackSmoke(x, y) {
        const p = this.smokePool.find(s => !s.active);
        if (!p) return;
        p.active = true;
        p.isFire = false;
        p.x = x + (Math.random() - 0.5) * 6;
        p.y = y + randRange(4, 10);
        p.vx = (Math.random() - 0.5) * 0.5;
        p.vy = 0.6 + Math.random() * 0.6;   // drifts down from the exhaust
        p.life = 0;
        p.maxLife = 32 + Math.random() * 14;
        p.r0 = 6;
        p.r1 = 18;
    }

    // Tinted sparkle burst — used as both muzzle flash and impact splash for
    // the player's weapons. Reuses sparkPool; no smoke (plasma reads clean).
    // `hueBase` is the HSL hue around which sparks vary by ±15°.
    //   raygun → 125 (green)
    //   M16    → 50  (yellow/orange)
    spawnPlasmaImpact(x, y, count = 10, hueBase = 125) {
        for (let i = 0; i < count; i++) {
            const p = this.sparkPool.find(s => !s.active);
            if (!p) return;
            p.active = true;
            p.x = x; p.y = y;
            const angle = Math.random() * Math.PI * 2;
            const speed = 1.6 + Math.random() * 2.4;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.6;
            p.life = 0;
            p.maxLife = 14 + Math.random() * 10;    // ~230-400ms — quick fade
            p.size = 3 + Math.random() * 4;
            p.rot = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 0.5;
            p.hue = hueBase - 15 + Math.random() * 30;
        }
    }

    // Warm radial burst + smoke. Used when a bullet explodes (stomp or kill).
    spawnExplosion(x, y) {
        for (let i = 0; i < 14; i++) {
            const p = this.sparkPool.find(s => !s.active);
            if (!p) break;
            p.active = true;
            p.x = x; p.y = y;
            const angle = Math.random() * Math.PI * 2;
            const speed = 2.5 + Math.random() * 4.0;
            p.vx = Math.cos(angle) * speed;
            p.vy = Math.sin(angle) * speed - 0.6;
            p.life = 0;
            p.maxLife = 24 + Math.random() * 18;
            p.size = 4 + Math.random() * 6;
            p.rot = Math.random() * Math.PI * 2;
            p.rotSpeed = (Math.random() - 0.5) * 0.5;
            // Warm: deep orange (24) → yellow (52)
            p.hue = 24 + Math.random() * 28;
        }
        for (let i = 0; i < 4; i++) {
            this.spawnSmokePuff(
                x + (Math.random() - 0.5) * 24,
                y + (Math.random() - 0.5) * 24
            );
        }
    }

    update(step) {
        for (const p of this.popupPool) {
            if (!p.active) continue;
            p.y += p.vy * step;
            p.life += step;
            if (p.life >= p.maxLife) p.active = false;
        }
        for (const p of this.sparkPool) {
            if (!p.active) continue;
            p.x += p.vx * step;
            p.y += p.vy * step;
            p.vy += 0.18 * step;                 // light gravity on sparkles
            p.vx *= Math.pow(0.96, step);        // air drag
            p.rot += p.rotSpeed * step;
            p.life += step;
            if (p.life >= p.maxLife) p.active = false;
        }
        for (const p of this.smokePool) {
            if (!p.active) continue;
            p.x += p.vx * step;
            p.y += p.vy * step;
            p.vx *= Math.pow(0.94, step);
            p.life += step;
            if (p.life >= p.maxLife) p.active = false;
        }
    }

    render(ctx, cameraY) {
        this._renderSmoke(ctx, cameraY);
        this._renderSparks(ctx, cameraY);
        this._renderPopups(ctx, cameraY);
    }

    _renderSmoke(ctx, cameraY) {
        ctx.save();
        for (const p of this.smokePool) {
            if (!p.active) continue;
            const t = p.life / p.maxLife;
            const r = lerp(p.r0, p.r1, t);
            const sx = p.x;
            const sy = p.y - cameraY;
            if (p.isFire) {
                // Warm radial gradient (yellow core → orange → red fade).
                const alpha = clamp(1 - t * t, 0, 1);
                const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, r);
                grad.addColorStop(0.0, `rgba(255, 232, 140, ${(alpha * 0.95).toFixed(3)})`);
                grad.addColorStop(0.5, `rgba(255, 140, 40, ${(alpha * 0.80).toFixed(3)})`);
                grad.addColorStop(1.0, 'rgba(210, 40, 0, 0)');
                ctx.fillStyle = grad;
            } else {
                const alpha = 0.55 * (1 - t);
                ctx.fillStyle = `rgba(180, 180, 180, ${alpha.toFixed(3)})`;
            }
            ctx.beginPath();
            ctx.arc(sx, sy, r, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }

    _renderPopups(ctx, cameraY) {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineJoin = 'round';
        for (const p of this.popupPool) {
            if (!p.active) continue;
            const t = p.life / p.maxLife;
            const screenY = p.y - cameraY;
            const text = p.text != null ? p.text : ('+' + p.value);
            const px = p.fontPx || 30;
            ctx.font = `bold ${px}px "Nunito", "Segoe UI", system-ui, sans-serif`;
            ctx.globalAlpha = 1 - t;
            // Stroke scales with size so the outline stays proportional.
            ctx.lineWidth = Math.max(3, px * 0.18);
            ctx.strokeStyle = '#2b2140';
            ctx.fillStyle = p.color || '#fff8d6';
            ctx.strokeText(text, p.x, screenY);
            ctx.fillText(text, p.x, screenY);
        }
        ctx.restore();
    }

    _renderSparks(ctx, cameraY) {
        ctx.save();
        ctx.lineJoin = 'round';
        for (const p of this.sparkPool) {
            if (!p.active) continue;
            const t = p.life / p.maxLife;
            const alpha = clamp(1 - t * t, 0, 1);   // hold bright, then fade
            const scale = 1 - t * 0.5;
            const screenY = p.y - cameraY;
            ctx.save();
            ctx.translate(p.x, screenY);
            ctx.rotate(p.rot);
            ctx.scale(scale, scale);
            ctx.globalAlpha = alpha;
            this._drawStar(ctx, p.size, `hsl(${p.hue}, 100%, 72%)`, '#b86d12');
            ctx.restore();
        }
        ctx.restore();
    }

    _drawStar(ctx, size, fill, stroke) {
        const spikes = 5;
        const outer = size;
        const inner = size * 0.42;
        ctx.beginPath();
        for (let i = 0; i < spikes * 2; i++) {
            const r = i % 2 === 0 ? outer : inner;
            const ang = (i / (spikes * 2)) * Math.PI * 2 - Math.PI / 2;
            const x = Math.cos(ang) * r;
            const y = Math.sin(ang) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = stroke;
        ctx.stroke();
    }

    reset() {
        for (const p of this.popupPool) p.active = false;
        for (const p of this.sparkPool) p.active = false;
        for (const p of this.smokePool) p.active = false;
    }
}


// ============================================================
// drawBackground — looping time-of-day cycle
//   morning → day → sunset → dusk → night → morning (wraps)
// ============================================================

// Each CYCLE_LENGTH px of ascent is one full day/night loop. Tuned so
// the average run sees multiple transitions — at 35000 most players
// never saw night. 14000 lets dusk and night land inside a typical
// climb and then swing back to morning before the run ends.
const CYCLE_LENGTH = 20000;

// [phase 0..1, topColor, botColor]. Last entry duplicates the first so
// interpolation wraps cleanly back to morning. The day and night tiers
// each include a plateau (two adjacent frames with the same color) so
// "full day" and "deep night" linger instead of flashing past — the
// night plateau (0.65 → 0.92) is the longer of the two because a run
// should feel noticeably dark when it's night, not whip back to dawn
// after a few jumps.
const SKY_KEYFRAMES = [
    [0.00, '#ffc18a', '#ffe9c9'], // sunrise / morning
    [0.10, '#9fd0ec', '#e1f2fa'], // late morning
    [0.25, '#6fbde3', '#bfe3f3'], // day peak
    [0.42, '#6fbde3', '#bfe3f3'], // day plateau (holds full day)
    [0.52, '#f09149', '#ffcf8d'], // sunset
    [0.60, '#5d4079', '#b87398'], // dusk
    [0.65, '#0c1b3a', '#2a3964'], // deep night start
    [0.92, '#0c1b3a', '#2a3964'], // deep night end (long plateau)
    [1.00, '#ffc18a', '#ffe9c9']  // wrap → sunrise
];

function skyColorAt(phase) {
    let i = 0;
    while (i < SKY_KEYFRAMES.length - 1 && SKY_KEYFRAMES[i + 1][0] <= phase) i++;
    const [p0, t0, b0] = SKY_KEYFRAMES[i];
    const [p1, t1, b1] = SKY_KEYFRAMES[Math.min(i + 1, SKY_KEYFRAMES.length - 1)];
    const local = p1 === p0 ? 0 : clamp((phase - p0) / (p1 - p0), 0, 1);
    const eased = local * local * (3 - 2 * local);
    return { top: lerpColor(t0, t1, eased), bot: lerpColor(b0, b1, eased) };
}

// Stars peak during the night plateau (phase 0.65 → 0.92).
function starIntensityAt(phase) {
    return smoothstep(0.60, 0.67, phase) * (1 - smoothstep(0.93, 0.99, phase));
}

// Mountains visible morning → sunset, fade through dusk, gone across the
// whole night plateau, reappear as the new morning begins.
function mountainOpacityAt(phase) {
    if (phase < 0.52) return 1;
    if (phase < 0.65) return 1 - (phase - 0.52) / 0.13;
    if (phase < 0.96) return 0;
    return (phase - 0.96) / 0.04;
}

// Night-difficulty factor (0..1). 1.0 across the deep-night plateau
// (phase 0.67 → 0.92) with short ramps through dusk and pre-dawn so the
// speed/cap changes don't snap on. Read by Bullet/Bird/KingBill managers
// to ramp up hostility at night, and by Bullet.update() so live
// projectiles also speed up mid-flight.
function nightFactorAtPhase(phase) {
    return smoothstep(0.62, 0.68, phase) * (1 - smoothstep(0.92, 0.97, phase));
}
function nightFactorAt(ascent) {
    const phase = (((ascent % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH) / CYCLE_LENGTH;
    return nightFactorAtPhase(phase);
}
// Per-category night multipliers. Plateau value = (1 + the constant).
// Tune here — everything downstream reads these.
const NIGHT_BULLET_SPEED_BOOST = 0.22;   // +22% speed at peak night
const NIGHT_BIRD_SPEED_BOOST   = 0.18;   // +18% bird speed at peak night
const NIGHT_BULLET_CAP_BONUS   = 1;      // extra concurrent bullets during night
// Threshold above which the +1 max-alive bonus kicks in. Using the smooth
// factor would make the cap flap on/off during the ramp — compare against
// a hard threshold instead so the bonus engages once, at true night.
const NIGHT_CAP_BONUS_THRESHOLD = 0.5;

const drawBackground = (() => {
    let bgClouds = null;
    let stars = null;

    function ensureLayers(viewportW) {
        if (!bgClouds) {
            bgClouds = [];
            for (let i = 0; i < 14; i++) {
                bgClouds.push({
                    worldY: Math.random() * 6000 - 3000,
                    x: Math.random() * viewportW,
                    size: 28 + Math.random() * 70,
                    drift: 4 + Math.random() * 12,
                    opacity: 0.25 + Math.random() * 0.4
                });
            }
        }
        if (!stars) {
            stars = [];
            for (let i = 0; i < 120; i++) {
                stars.push({
                    x: Math.random(),
                    yMod: Math.random() * 1500,
                    size: 0.6 + Math.random() * 1.8,
                    twinkle: Math.random() * Math.PI * 2
                });
            }
        }
    }

    function recycleBgCloud(c, cameraY, w) {
        c.worldY = cameraY * 0.3 - randRange(60, 700);
        c.x = Math.random() * w;
    }

    return function drawBackground(ctx, cameraY, ascent, w, h, time, dt) {
        ensureLayers(w);

        const phase = (((ascent % CYCLE_LENGTH) + CYCLE_LENGTH) % CYCLE_LENGTH) / CYCLE_LENGTH;
        const { top, bot } = skyColorAt(phase);

        // ---- Sky gradient ----
        const grad = ctx.createLinearGradient(0, 0, 0, h);
        grad.addColorStop(0, top);
        grad.addColorStop(1, bot);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // ---- Stars (night window only) ----
        const starIntensity = starIntensityAt(phase);
        if (starIntensity > 0.01) {
            for (const s of stars) {
                let yScroll = (s.yMod + cameraY * 0.5);
                yScroll = ((yScroll % 1500) + 1500) % 1500;
                const screenY = yScroll * (h / 1500);
                const a = starIntensity * (0.45 + 0.55 * Math.sin(time * 2 + s.twinkle));
                if (a < 0.02) continue;
                ctx.fillStyle = `rgba(255, 250, 220, ${a})`;
                ctx.fillRect(s.x * w, screenY, s.size, s.size);
            }
        }

        // ---- Mountains (parallax in X only so they persist across cycles) ----
        const mountainOpacity = mountainOpacityAt(phase);
        if (mountainOpacity > 0.01) {
            const mountainBaseY = h * 0.78;
            const xScroll1 = -cameraY * 0.10;
            ctx.fillStyle = `rgba(80, 100, 150, ${(0.45 * mountainOpacity).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = -50; x <= w + 50; x += 40) {
                const peak = Math.sin((x + xScroll1) * 0.013) * 60 + Math.sin((x + xScroll1) * 0.041 + 1.3) * 22;
                ctx.lineTo(x, mountainBaseY - 60 + peak);
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();

            const xScroll2 = -cameraY * 0.18;
            ctx.fillStyle = `rgba(60, 78, 130, ${(0.55 * mountainOpacity).toFixed(3)})`;
            ctx.beginPath();
            ctx.moveTo(0, h);
            for (let x = -50; x <= w + 50; x += 40) {
                const peak = Math.sin((x + xScroll2) * 0.018 + 0.9) * 42 + Math.sin((x + xScroll2) * 0.056 + 0.4) * 18;
                ctx.lineTo(x, mountainBaseY - 30 + peak);
            }
            ctx.lineTo(w, h);
            ctx.closePath();
            ctx.fill();
        }

        // ---- Drifting background clouds (parallax 0.3, dimmed at night) ----
        const dimByNight = 1 - starIntensity * 0.55;
        for (const c of bgClouds) {
            c.x = (c.x + c.drift * dt + w + 200) % (w + 200);
            const screenY = c.worldY - cameraY * 0.3;
            if (screenY > h + 100) {
                recycleBgCloud(c, cameraY, w);
                continue;
            }
            if (screenY < -200) continue;
            ctx.globalAlpha = c.opacity * dimByNight;
            ctx.fillStyle = '#ffffff';
            const sz = c.size;
            ctx.beginPath();
            ctx.ellipse(c.x, screenY, sz, sz * 0.5, 0, 0, Math.PI * 2);
            ctx.ellipse(c.x - sz * 0.55, screenY + sz * 0.12, sz * 0.6, sz * 0.4, 0, 0, Math.PI * 2);
            ctx.ellipse(c.x + sz * 0.55, screenY + sz * 0.12, sz * 0.6, sz * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    };
})();


// ============================================================
// ShopUI — purchase & equip weapons, persisted via Game.settings
// ============================================================
//
// One instance, owned by Game. Reads `game.coins`, `game.settings.ownedWeapons`,
// and `game.settings.equippedWeapon`; writes through `game._spendCoins()` and
// `game._saveSettings()`. Weapon equip/unequip goes through
// `game._applyEquippedWeapon()` so the Player is kept in sync from a single
// code path (boot + shop mutations both flow through it).
//
// The card's Buy→Equip→Equipped state is derived on every render from those
// three sources — ShopUI holds no duplicate state of its own.
class ShopUI {
    constructor(game) {
        this.game = game;
        this.fromOverlay = null;  // 'ready' | 'gameover' — which modal to return to on Back
        const grid = this.game.dom.shopGrid;
        grid.addEventListener('click', (e) => this._onGridClick(e));
        // Mouse drag-to-scroll. Touch & trackpad work via native overflow-x;
        // this adds click-drag for desktop mice. Drag > 5px suppresses the
        // trailing click so dragging doesn't accidentally buy a weapon.
        this._drag = { active: false, startX: 0, startScroll: 0, moved: 0 };
        grid.addEventListener('pointerdown', (e) => this._onDragStart(e));
        grid.addEventListener('pointermove', (e) => this._onDragMove(e));
        grid.addEventListener('pointerup',   (e) => this._onDragEnd(e));
        grid.addEventListener('pointercancel', (e) => this._onDragEnd(e));
    }

    // Display order: No Weapon → non-legendary by price desc → legendary by
    // price desc (always last). Keeps legendary items visually "endgame"
    // regardless of price. Called fresh every render; the underlying
    // SHOP_ITEMS can be in any order.
    _sortedItems() {
        return [...SHOP_ITEMS].sort((a, b) => {
            if (a.key === null && b.key !== null) return -1;
            if (b.key === null && a.key !== null) return 1;
            const aLeg = a.rarity === 'legendary' ? 1 : 0;
            const bLeg = b.rarity === 'legendary' ? 1 : 0;
            if (aLeg !== bLeg) return aLeg - bLeg;
            return b.price - a.price;
        });
    }

    open(fromOverlay) {
        this.fromOverlay = fromOverlay;
        const { dom } = this.game;
        if (fromOverlay === 'gameover') dom.gameover.classList.add('is-hidden');
        else                            dom.ready.classList.add('is-hidden');
        dom.shop.classList.remove('is-hidden');
        this._render();
        if (window.gsap) {
            gsap.from(dom.shop.querySelector('.overlay__card'), {
                scale: 0.85, opacity: 0, duration: 0.3, ease: 'back.out(1.7)'
            });
        }
    }

    close() {
        const { dom } = this.game;
        dom.shop.classList.add('is-hidden');
        if (this.fromOverlay === 'gameover') dom.gameover.classList.remove('is-hidden');
        else                                 dom.ready.classList.remove('is-hidden');
    }

    _render() {
        const g = this.game;
        g.dom.shopBalance.textContent = g.coins;
        const owned = g.settings.ownedWeapons;
        const equipped = g.settings.equippedWeapon;
        const frag = document.createDocumentFragment();
        for (const item of this._sortedItems()) {
            frag.appendChild(this._buildCard(item, owned, equipped, g.coins));
        }
        g.dom.shopGrid.replaceChildren(frag);
    }

    _buildCard(item, owned, equipped, coins) {
        const rarity = item.rarity ? RARITY[item.rarity] : null;
        const card = document.createElement('div');
        card.className = 'shop-card';
        card.dataset.weaponKey = item.key == null ? '' : item.key;
        if (item.rarity) card.dataset.rarity = item.rarity;

        if (rarity) {
            const chip = document.createElement('div');
            chip.className = 'shop-card__rarity';
            chip.textContent = rarity.label;
            card.appendChild(chip);
        }

        const imgWrap = document.createElement('div');
        imgWrap.className = 'shop-card__img-wrap';
        if (item.image) {
            const img = document.createElement('img');
            img.className = 'shop-card__img';
            img.src = item.image;
            img.alt = item.name;
            imgWrap.appendChild(img);
        } else {
            const empty = document.createElement('div');
            empty.className = 'shop-card__img-empty';
            empty.textContent = '—';
            imgWrap.appendChild(empty);
        }
        card.appendChild(imgWrap);

        const name = document.createElement('div');
        name.className = 'shop-card__name';
        name.textContent = item.name;
        card.appendChild(name);

        // No-Weapon card has no price and no ammo row.
        const isOwned = item.key == null || owned.includes(item.key);
        if (!isOwned && item.price > 0) {
            const price = document.createElement('div');
            price.className = 'shop-card__price';
            const coinImg = document.createElement('img');
            coinImg.className = 'coin-icon coin-icon--inline';
            coinImg.src = 'assets/coin.png';
            coinImg.alt = '';
            price.appendChild(coinImg);
            price.appendChild(document.createTextNode(String(item.price)));
            card.appendChild(price);
        }

        // Action button: state derived from ownership + equipped + balance.
        // Equipped state shows "Unequip" (explicit action, generic color) —
        // the card also carries data-equipped="true" so CSS can add an
        // "Equipped" status ribbon.
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn shop-card__action';
        const isEquipped = equipped === item.key || (equipped == null && item.key == null);
        if (isEquipped) {
            card.dataset.equipped = 'true';
            if (item.key == null) {
                // "No Weapon" while equipped is a dead-end — nothing to unequip to.
                btn.dataset.action = 'equipped';
                btn.textContent = 'Equipped';
                btn.disabled = true;
            } else {
                btn.dataset.action = 'unequip';
                btn.textContent = 'Unequip';
            }
        } else if (isOwned) {
            btn.dataset.action = 'equip';
            btn.textContent = 'Equip';
        } else {
            btn.dataset.action = 'buy';
            btn.textContent = `Buy`;
            if (coins < item.price) btn.disabled = true;
        }
        card.appendChild(btn);
        return card;
    }

    _onGridClick(e) {
        // Guard: if the user was dragging the carousel, suppress the trailing click.
        if (this._drag.moved > 5) return;
        const btn = e.target.closest('.shop-card__action');
        if (!btn || btn.disabled) return;
        const card = btn.closest('.shop-card');
        if (!card) return;
        const keyAttr = card.dataset.weaponKey;
        const key = keyAttr === '' ? null : keyAttr;
        const item = SHOP_ITEMS.find(i => i.key === key);
        if (!item) return;
        const g = this.game;
        const action = btn.dataset.action;
        if (action === 'buy') {
            if (!g._spendCoins(item.price)) return;
            if (!g.settings.ownedWeapons.includes(key)) g.settings.ownedWeapons.push(key);
            g.settings.equippedWeapon = key;
            g._saveSettings();
            g._applyEquippedWeapon();
        } else if (action === 'equip') {
            g.settings.equippedWeapon = key;
            g._saveSettings();
            g._applyEquippedWeapon();
        } else if (action === 'unequip') {
            g.settings.equippedWeapon = null;
            g._saveSettings();
            g._applyEquippedWeapon();
        }
        this._render();
    }

    // --- Horizontal drag-to-scroll for the shop carousel ---
    _onDragStart(e) {
        // Only left mouse button; touches go straight through native scroll.
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        const grid = this.game.dom.shopGrid;
        this._drag.active = true;
        this._drag.startX = e.clientX;
        this._drag.startScroll = grid.scrollLeft;
        this._drag.moved = 0;
        grid.classList.add('is-dragging');
    }
    _onDragMove(e) {
        if (!this._drag.active) return;
        const dx = e.clientX - this._drag.startX;
        this._drag.moved = Math.max(this._drag.moved, Math.abs(dx));
        this.game.dom.shopGrid.scrollLeft = this._drag.startScroll - dx;
    }
    _onDragEnd() {
        if (!this._drag.active) return;
        this._drag.active = false;
        this.game.dom.shopGrid.classList.remove('is-dragging');
        // _drag.moved lingers for the click handler to read, then resets on next drag.
    }
}


// ============================================================
// Game — top-level orchestrator
// ============================================================

class Game {
    constructor() {
        this.canvas = document.getElementById('game');
        this.ctx = this.canvas.getContext('2d');
        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        // Viewport holds LOGICAL dimensions (world-space), which are larger
        // than the CSS window when WORLD_ZOOM < 1. The render transform in
        // _applyDpr collapses logical → CSS at the end.
        this.viewport = {
            w: window.innerWidth  / WORLD_ZOOM,
            h: window.innerHeight / WORLD_ZOOM
        };

        this.assets = new AssetLoader();
        this.input = new InputManager(this.canvas);
        this.camera = new Camera();
        this.particles = new ParticleSystem();
        this.jumpAudio = new AudioPool(ASSETS.jumpSound, 6);
        // Per-weapon SFX. Lookup is by weapon.fireSoundKey. Pool of 8 covers
        // M16's ~11 rps cyclic rate even if the clip is a touch over 90 ms.
        this.weaponAudio = {
            // Pool size scales with cyclic rate — vector SMG is ~2x M16's ROF,
            // so double the pool to avoid cutting clips at peak fire.
            m16Fire:       new AudioPool(ASSETS.m16Fire, 8),
            vectorSmgFire: new AudioPool(ASSETS.vectorSmgFire, 16),
            // Raygun is semi-auto (~4 rps max), so 4 per variant is ample.
            raygunFire:    new AudioPool(ASSETS.raygunFire, 4),
            // Bazooka: low-ROF fire, a small pool handles overlap fine.
            // Explosion uses `noRepeat: false` so the two clips are
            // rolled independently — back-to-back repeats feel natural
            // for explosions (unlike gun shots).
            bazookaFire:      new AudioPool(ASSETS.bazookaFire, 3),
            bazookaExplosion: new AudioPool(ASSETS.bazookaExplosion, 4, false),
            // Minigun sustained-fire trio. Pool size 2 so an end-sound from
            // a fading cycle can overlap briefly with the start of a new one
            // (e.g. overheat → resume while trigger still held).
            minigunStart:    new AudioPool(ASSETS.minigunStart, 2),
            minigunShooting: new AudioPool(ASSETS.minigunShooting, 2),
            minigunEnding:   new AudioPool(ASSETS.minigunEnding, 2),
            minigunOverheat: new AudioPool(ASSETS.minigunOverheat, 2)
        };
        // Currently-playing sustained-fire Audio element (null when idle).
        // Set by the `sustained-start` audio event and paused by
        // `sustained-stop`. Kept on Game because AudioPools don't own
        // playback state beyond the element itself.
        this.sustainedWeaponAudio = null;

        this.player = null;
        this.clouds = null;
        this.bulletManager = null;
        this.birdManager = null;
        this.jetpackManager = null;
        this.coinManager = null;
        this._jetpackSmokeCooldown = 0;   // throttles idle smoke emission

        this.state = 'loading'; // loading → ready → playing → (dying →) gameover → playing → ...
        this.score = 0;
        this.cloudsJumped = 0;
        this.survivalMs = 0;     // ms accumulator for the +1/250ms survival tick
        this.highscore = this._loadHighScore();
        // Lifetime coin balance — seeded async from the signed cookie. Starts
        // at 0; HUD is refreshed the moment the cookie parse resolves.
        this.coins = 0;
        this.coinsEarnedThisRun = 0;
        loadCoinBalance().then(n => { this.coins = n; this._updateCoinHUD(); });
        this.muted = this._loadMute();
        this.settings = this._loadSettings();
        // Apply saved zoom BEFORE first _applyDpr — the viewport dimensions
        // depend on WORLD_ZOOM, so we also recompute them here. The slider
        // value stays baselined to 1080p; the active WORLD_ZOOM picks up
        // the resolution scale so the world looks the same on any monitor.
        const baselineZoom = clamp(
            typeof this.settings.zoom === 'number' ? this.settings.zoom : 0.8,
            ZOOM_MIN, ZOOM_MAX
        );
        this.settings.zoom = baselineZoom;
        WORLD_ZOOM = effectiveWorldZoom(baselineZoom);
        this.viewport.w = window.innerWidth  / WORLD_ZOOM;
        this.viewport.h = window.innerHeight / WORLD_ZOOM;
        SENSITIVITY = clamp(
            typeof this.settings.sensitivity === 'number' ? this.settings.sensitivity : 1.0,
            SENSITIVITY_MIN, SENSITIVITY_MAX
        );
        this.settings.sensitivity = SENSITIVITY;
        // Master volume — tolerant of missing/garbage stored values.
        const v = typeof this.settings.volume === 'number' ? this.settings.volume : 1.0;
        this.settings.volume = clamp(v, 0, 1);
        setMasterVolume(this.settings.volume);
        // Music settings — tolerant of missing/garbage stored values.
        this.settings.musicEnabled = this.settings.musicEnabled !== false;
        this.settings.musicVolume  = clamp(
            typeof this.settings.musicVolume === 'number' ? this.settings.musicVolume : 0.5,
            0, 1
        );
        if (!MUSIC_TRACKS.some(t => t.key === this.settings.musicTrack)) {
            this.settings.musicTrack = DEFAULT_MUSIC_TRACK;
        }
        this.musicPlayer = new MusicPlayer(MUSIC_TRACKS);
        this.musicPlayer.volume     = this.settings.musicVolume;
        this.musicPlayer.enabled    = this.settings.musicEnabled;
        this.musicPlayer.muted      = this.muted;
        // Seed page-visibility state — covers the "page opened in a
        // background tab" case where visibilitychange doesn't fire until
        // the user focuses the tab.
        this.musicPlayer.pageHidden = document.visibilityState === 'hidden';
        this.musicPlayer.setTrack(this.settings.musicTrack);
        // Pause music whenever the tab is backgrounded (switching tabs in
        // Brave/Chrome fires this immediately). Resumes on return — the
        // player respects enabled/muted so a muted session stays muted.
        document.addEventListener('visibilitychange', () => {
            this.musicPlayer.setPageHidden(document.visibilityState === 'hidden');
        });
        // Autoplay is blocked until the user interacts with the page.
        // The first pointerdown/keydown anywhere retries playback once.
        const unlockMusic = () => {
            this.musicPlayer.unlock();
            window.removeEventListener('pointerdown', unlockMusic, true);
            window.removeEventListener('keydown',     unlockMusic, true);
            window.removeEventListener('touchstart',  unlockMusic, true);
        };
        window.addEventListener('pointerdown', unlockMusic, true);
        window.addEventListener('keydown',     unlockMusic, true);
        window.addEventListener('touchstart',  unlockMusic, true);
        // Normalize hit-marker toggle — tolerant of missing/garbage stored values.
        this.settings.showHitMarker = !!this.settings.showHitMarker;
        this.flashT = 0;          // 1 → 0 white-flash overlay decay
        this.deathBolt = null;    // transient bolt rendered during a storm-strike death
        this.dyingAt = 0;         // performance.now() snapshot when the strike fired

        this.lastTime = 0;
        this.startTime = performance.now();
        this.lastDt = 1 / 60;

        this.dom = {
            loading: document.getElementById('overlay-loading'),
            ready: document.getElementById('overlay-ready'),
            gameover: document.getElementById('overlay-gameover'),
            pause: document.getElementById('overlay-pause'),
            settings: document.getElementById('overlay-settings'),
            hotkeys: document.getElementById('hotkeys'),
            score: document.getElementById('score'),
            highscore: document.getElementById('highscore'),
            coins: document.getElementById('coins'),
            coinsEarned: document.getElementById('coins-earned'),
            coinsTotal: document.getElementById('coins-total'),
            finalScore: document.getElementById('final-score'),
            finalHigh: document.getElementById('final-highscore'),
            newHigh: document.getElementById('new-high'),
            btnStart: document.getElementById('btn-start'),
            btnRestart: document.getElementById('btn-restart'),
            btnResume: document.getElementById('btn-resume'),
            btnPauseMenu: document.getElementById('btn-pause-menu'),
            btnGameoverMenu: document.getElementById('btn-gameover-menu'),
            btnMute: document.getElementById('btn-mute'),
            btnJump: document.getElementById('btn-jump'),
            btnPause: document.getElementById('btn-pause'),
            btnSettings: document.getElementById('btn-settings'),
            btnSettingsBack: document.getElementById('btn-settings-back'),
            shop: document.getElementById('overlay-shop'),
            shopGrid: document.getElementById('shop-grid'),
            shopBalance: document.getElementById('shop-coin-balance'),
            btnShop: document.getElementById('btn-shop'),
            btnShopGameover: document.getElementById('btn-shop-gameover'),
            btnShopBack: document.getElementById('btn-shop-back'),
            toggleDoubleJump: document.getElementById('toggle-doublejump'),
            toggleCursor: document.getElementById('toggle-cursor'),
            toggleSound: document.getElementById('toggle-sound'),
            toggleMusic: document.getElementById('toggle-music'),
            musicVolumeSlider: document.getElementById('music-volume-slider'),
            musicVolumeValue:  document.getElementById('music-volume-value'),
            toggleHitMarker: document.getElementById('toggle-hitmarker'),
            zoomSlider: document.getElementById('zoom-slider'),
            zoomValue: document.getElementById('zoom-value'),
            sensitivitySlider: document.getElementById('sensitivity-slider'),
            sensitivityValue: document.getElementById('sensitivity-value'),
            volumeSlider: document.getElementById('volume-slider'),
            volumeValue: document.getElementById('volume-value'),
            settingsMuteBtn:   document.getElementById('settings-mute-btn'),
            pauseVolumeSlider: document.getElementById('pause-volume-slider'),
            pauseVolumeValue:  document.getElementById('pause-volume-value'),
            pauseMuteBtn:      document.getElementById('pause-mute-btn'),
            segmentedBtns: Array.from(document.querySelectorAll('.segmented__btn')),
            muteLabel: document.getElementById('mute-label'),
            fuelGauge: document.getElementById('fuel-gauge'),
            fuelFill: document.getElementById('fuel-gauge-fill'),
            fuelLabel: document.getElementById('fuel-gauge-label'),
            btnJetpack: document.getElementById('btn-jetpack')
        };
        this.dom.btnStart.addEventListener('click', () => this.play());
        this.dom.btnRestart.addEventListener('click', () => this.play());
        this.dom.btnResume.addEventListener('click', () => this._resume());
        this.dom.btnPauseMenu.addEventListener('click', () => this._goToMainMenu());
        this.dom.btnGameoverMenu.addEventListener('click', () => this._goToMainMenu());
        this.dom.btnMute.addEventListener('click', () => this.toggleMute());
        this.dom.btnSettings.addEventListener('click', () => this._showSettings());
        this.dom.btnSettingsBack.addEventListener('click', () => this._hideSettings());
        this.shop = new ShopUI(this);
        this.dom.btnShop.addEventListener('click', () => this.shop.open('ready'));
        this.dom.btnShopGameover.addEventListener('click', () => this.shop.open('gameover'));
        this.dom.btnShopBack.addEventListener('click', () => this.shop.close());
        this.dom.toggleDoubleJump.addEventListener('click', () => {
            this.settings.doubleJump = !this.settings.doubleJump;
            this._saveSettings();
            this._refreshSettingsUI();
        });
        this.dom.toggleCursor.addEventListener('click', () => {
            this.settings.hideCursor = !this.settings.hideCursor;
            this._saveSettings();
            this._refreshSettingsUI();
        });
        // Sound toggle mirrors the existing M-key mute; state lives on `this.muted`
        // (separate localStorage key from the settings blob).
        this.dom.toggleSound.addEventListener('click', () => this.toggleMute());
        if (this.dom.toggleHitMarker) {
            this.dom.toggleHitMarker.addEventListener('click', () => {
                this.settings.showHitMarker = !this.settings.showHitMarker;
                this._saveSettings();
                this._refreshSettingsUI();
            });
        }
        for (const seg of this.dom.segmentedBtns) {
            seg.addEventListener('click', () => {
                this.settings.difficulty = seg.dataset.difficulty;
                this._saveSettings();
                this._applyDifficulty();
                this._refreshSettingsUI();
            });
        }
        if (this.dom.zoomSlider) {
            this.dom.zoomSlider.addEventListener('input', (e) => {
                this._applyZoom(parseFloat(e.target.value));
            });
        }
        if (this.dom.sensitivitySlider) {
            this.dom.sensitivitySlider.addEventListener('input', (e) => {
                this._applySensitivity(parseFloat(e.target.value));
            });
        }
        if (this.dom.volumeSlider) {
            this.dom.volumeSlider.addEventListener('input', (e) => {
                this._applyVolume(parseFloat(e.target.value));
            });
        }
        if (this.dom.pauseVolumeSlider) {
            this.dom.pauseVolumeSlider.addEventListener('input', (e) => {
                this._applyVolume(parseFloat(e.target.value));
            });
        }
        if (this.dom.toggleMusic) {
            this.dom.toggleMusic.addEventListener('click', () => {
                this.settings.musicEnabled = !this.settings.musicEnabled;
                this.musicPlayer.setEnabled(this.settings.musicEnabled);
                this._saveSettings();
                this._refreshSettingsUI();
            });
        }
        if (this.dom.musicVolumeSlider) {
            this.dom.musicVolumeSlider.addEventListener('input', (e) => {
                this._applyMusicVolume(parseFloat(e.target.value));
            });
        }
        if (this.dom.pauseMuteBtn) {
            this.dom.pauseMuteBtn.addEventListener('click', () => this.toggleMute());
        }
        if (this.dom.settingsMuteBtn) {
            this.dom.settingsMuteBtn.addEventListener('click', () => this.toggleMute());
        }
        // Touch-friendly mirrors of the keyboard shortcuts.
        this.dom.btnJump.addEventListener('click', () => {
            if (this.state !== 'playing' || !this.player) return;
            if (this.player.tryDoubleJump(this.settings.doubleJump)) this._onDoubleJump();
        });
        this.dom.btnPause.addEventListener('click', () => {
            if (this.state === 'playing') this._pause();
            else if (this.state === 'paused') this._resume();
        });

        this.pauseStartedAt = 0;

        // Global M-key shortcut. Handled outside InputManager because it isn't
        // a gameplay action and should work in every state.
        window.addEventListener('keydown', (e) => {
            if (e.repeat) return;
            if (e.key === 'm' || e.key === 'M') {
                this.toggleMute();
                e.preventDefault();
            }
        });

        // Global Space → double-jump. Always preventDefault so the focused
        // overlay button (Start / Play Again) doesn't auto-activate on Space.
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Space' && e.key !== ' ') return;
            e.preventDefault();
            if (e.repeat) return;
            if (this.state !== 'playing' || !this.player) return;
            if (this.player.tryDoubleJump(this.settings.doubleJump)) this._onDoubleJump();
        });

        // Global Escape → toggle pause (only meaningful while playing/paused).
        window.addEventListener('keydown', (e) => {
            if (e.key !== 'Escape' && e.code !== 'Escape') return;
            if (e.repeat) return;
            if (this.state === 'playing') this._pause();
            else if (this.state === 'paused') this._resume();
        });

        // Pointer lock — keep the OS cursor captured inside the canvas during
        // play so a fast mouse flick can't escape the window and dodge the
        // edge-clamp. If the lock is lost unexpectedly (Esc, alt-tab), auto-pause.
        document.addEventListener('pointerlockchange', () => {
            if (document.pointerLockElement !== this.canvas && this.state === 'playing') {
                this._pause();
            }
        });
        // If the user clicks the canvas mid-play (e.g. after a tab switch
        // released the lock), re-acquire the lock from that user gesture.
        this.canvas.addEventListener('click', () => {
            if (this.state === 'playing' && this.settings.hideCursor
                && document.pointerLockElement !== this.canvas) {
                this._acquirePointerLock();
            }
        });

        window.addEventListener('resize', () => this.handleResize());
        this._applyDpr();
        this.dom.highscore.textContent = this.highscore;
        this._updateMuteUI();
    }

    async start() {
        try {
            await this.assets.load();
        } catch (err) {
            console.error(err);
            this.dom.loading.querySelector('.overlay__subtitle').textContent = 'Failed to load assets.';
            return;
        }

        const mods = this._difficultyMods();
        this.player = new Player(this.assets.images.pandaLeft, this.assets.pandaLeftJetpackImage);
        this._applyEquippedWeapon();
        this.clouds = new CloudManager(this.assets.cloudImages, this.assets.darkCloudImages, mods);
        this.bulletManager = new BulletManager(this.assets.bulletImage, this.assets.missileImage, mods);
        this.kingBillManager = new KingBillManager(this.assets.kingBillImage, mods);
        this.birdManager = new BirdManager(this.assets.birdImage, mods);
        this.jetpackManager = new JetpackManager(this.assets.jetpackImage, mods);
        this.coinManager = new CoinManager(this.assets.coinImage);
        this.clouds.setCoinManager(this.coinManager);
        this.weaponSystem = new WeaponSystem();
        // Rocket-kind projectiles look up their sprite via weapon.rocketSpriteKey.
        this.weaponSystem.assets = this.assets;
        this.clouds.setViewport(this.viewport.w, this.viewport.h);
        this.camera.setViewport(this.viewport.h);
        this._setupReadyState();
        this._refreshSettingsUI();

        this.dom.loading.classList.add('is-hidden');
        this._showReady();

        this.lastTime = performance.now();
        requestAnimationFrame((t) => this._loop(t));
    }

    _setupReadyState() {
        // Scale player to fit small viewports
        this.player.setHeight(Math.min(PLAYER_BASE_HEIGHT, this.viewport.h * PLAYER_MIN_VIEWPORT_RATIO));
        const startFeetY = this.viewport.h * 0.62;
        this.player.reset(this.viewport.w / 2, startFeetY - this.player.height);
        this.camera.reset(0);
        this.clouds.reset(this.player.feetY);
        this.particles.reset();
        if (this.bulletManager) this.bulletManager.reset();
        if (this.kingBillManager) this.kingBillManager.reset();
        if (this.birdManager) this.birdManager.reset();
        if (this.jetpackManager) this.jetpackManager.reset();
        if (this.coinManager) this.coinManager.reset();
        if (this.weaponSystem) this.weaponSystem.reset();
        this._jetpackSmokeCooldown = 0;
        this.score = 0;
        this.cloudsJumped = 0;
        this.survivalMs = 0;
        this.coinsEarnedThisRun = 0;
        this.flashT = 0;
        this.deathBolt = null;
        this.dyingAt = 0;
        this._updateScoreHUD();
        this._updateCoinHUD();
        this._updateFuelGauge();
    }

    play() {
        this._setupReadyState();
        this.input.reset();
        this.dom.ready.classList.add('is-hidden');
        this.dom.gameover.classList.add('is-hidden');
        this.dom.pause.classList.add('is-hidden');
        this.dom.settings.classList.add('is-hidden');
        this.dom.hotkeys.classList.remove('is-hidden');
        this.canvas.style.cursor = this.settings.hideCursor ? 'none' : 'default';
        this.state = 'playing';
        this._acquirePointerLock();
    }

    _showReady() {
        this.state = 'ready';
        this.dom.ready.classList.remove('is-hidden');
        // The ready overlay already lists the shortcuts in its subtitle, so
        // hide the bottom-right hotkey strip to avoid duplication.
        this.dom.hotkeys.classList.add('is-hidden');
        if (window.gsap) {
            gsap.from(this.dom.ready.querySelector('.overlay__card'), {
                scale: 0.85, opacity: 0, duration: 0.45, ease: 'back.out(1.7)'
            });
        }
    }

    _showGameOver() {
        this.state = 'gameover';
        this.canvas.style.cursor = 'default';
        this._releasePointerLock();
        this._stopSustainedWeaponAudio();
        if (this.weaponSystem) this.weaponSystem._endFireCycle(true);
        if (this.player && this.player.jetpackActive) {
            this.player.removeJetpack();
        }
        this._updateFuelGauge();
        // Clear the bird so the DOM overlay parks off-screen — _update no
        // longer ticks the bird past this point, and without this the
        // overlay stays frozen at its last flight position.
        if (this.birdManager && this.birdManager.bird) {
            this.birdManager.bird.active = false;
        }
        // King Bills are canvas-drawn (not a DOM overlay like the bird),
        // so leaving them active lets them stay visible on the gameover
        // screen exactly like regular bullets/missiles do. They're reset
        // in _setupReadyState when the next run starts.
        const isNewHigh = this.score > this.highscore;
        if (isNewHigh) {
            this.highscore = this.score;
            this._saveHighScore();
        }
        this.dom.finalScore.textContent = this.score;
        this.dom.finalHigh.textContent = this.highscore;
        this.dom.highscore.textContent = this.highscore;
        if (this.dom.coinsEarned) this.dom.coinsEarned.textContent = this.coinsEarnedThisRun;
        if (this.dom.coinsTotal)  this.dom.coinsTotal.textContent  = this.coins;
        this.dom.newHigh.classList.toggle('is-hidden', !isNewHigh);
        this.dom.gameover.classList.remove('is-hidden');
        if (window.gsap) {
            gsap.from(this.dom.gameover.querySelector('.overlay__card'), {
                scale: 0.7, y: -30, opacity: 0, duration: 0.55, ease: 'back.out(1.7)'
            });
            if (isNewHigh) {
                gsap.from(this.dom.newHigh, {
                    scale: 0, rotate: -15, duration: 0.6, delay: 0.25, ease: 'back.out(2)'
                });
            }
        }
    }

    _pause() {
        if (this.state !== 'playing') return;
        this.state = 'paused';
        this.pauseStartedAt = performance.now();
        this.dom.pause.classList.remove('is-hidden');
        this.dom.hotkeys.classList.add('is-hidden');
        this.canvas.style.cursor = 'default';
        this._releasePointerLock();
        // Silence the sustained-fire loop across the pause; a fresh spin-up
        // will start again on resume if the trigger is still held.
        this._stopSustainedWeaponAudio();
        if (this.weaponSystem) this.weaponSystem._endFireCycle(true);
        // Sync the pause-overlay volume slider + speaker icon with current state
        // (volume settings might have changed via the Settings overlay earlier).
        this._refreshSettingsUI();
        this._updateMuteUI();
        if (window.gsap) {
            gsap.from(this.dom.pause.querySelector('.overlay__card'), {
                scale: 0.85, opacity: 0, duration: 0.3, ease: 'back.out(1.7)'
            });
        }
    }

    _resume() {
        if (this.state !== 'paused') return;
        // Wall-clock-driven schedules (bullet spawns, storm-cloud lightning,
        // death bolt) would all fire at once on resume otherwise — shift them
        // forward by however long we were paused.
        const pausedFor = performance.now() - this.pauseStartedAt;
        if (this.bulletManager) this.bulletManager.nextSpawnAt += pausedFor;
        if (this.kingBillManager) this.kingBillManager.nextSpawnAt += pausedFor;
        if (this.birdManager) this.birdManager.nextSpawnAt += pausedFor;
        if (this.jetpackManager) this.jetpackManager.nextSpawnAt += pausedFor;
        if (this.weaponSystem) this.weaponSystem.shiftSchedule(pausedFor);
        if (this.clouds) {
            for (const c of this.clouds.clouds) {
                if (c.bolts) {
                    c.nextSparkAt += pausedFor;
                    c.nextBoltAt += pausedFor;
                    for (const b of c.bolts) b.bornAt += pausedFor;
                }
            }
        }
        if (this.deathBolt) this.deathBolt.bornAt += pausedFor;
        // Avoid a giant dt on the first post-resume frame.
        this.lastTime = performance.now();
        this.dom.pause.classList.add('is-hidden');
        this.dom.hotkeys.classList.remove('is-hidden');
        this.canvas.style.cursor = this.settings.hideCursor ? 'none' : 'default';
        this.state = 'playing';
        this._acquirePointerLock();
    }

    _acquirePointerLock() {
        if (!this.settings.hideCursor) return;
        if (document.pointerLockElement === this.canvas) return;
        try {
            const p = this.canvas.requestPointerLock();
            if (p && typeof p.catch === 'function') p.catch(() => {});
        } catch (e) { /* some browsers throw if gesture is too old — ignore */ }
    }

    _releasePointerLock() {
        if (document.pointerLockElement === this.canvas) {
            try { document.exitPointerLock(); } catch (e) { /* ignore */ }
        }
    }

    _goToMainMenu() {
        // Abandon the current run (pause or game-over) and return to the Ready
        // screen — the single place where Settings + Start live.
        this._setupReadyState();
        this.dom.pause.classList.add('is-hidden');
        this.dom.gameover.classList.add('is-hidden');
        this.canvas.style.cursor = 'default';
        this._releasePointerLock();
        this._showReady();
        // Sync the ready-overlay clock so the first post-menu frame has a
        // normal dt (pause could have left a large gap).
        this.lastTime = performance.now();
    }

    _loop(now) {
        const dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        // Clamp dt so a tab-switch doesn't teleport the player through clouds
        const dtClamped = Math.min(dt, 1 / 30);
        const step = dtClamped * 60;
        this.lastDt = dtClamped;

        this._update(step);
        this._render();

        requestAnimationFrame((t) => this._loop(t));
    }

    _update(step) {
        if (this.state === 'paused') return;   // hard freeze — no physics, no particles, no decays
        if (this.state === 'playing') {
            // Jetpack fuel tick + thrust BEFORE the player's own update so
            // gravity integrates after thrust each frame.
            const jetpackExpired = this.player.tickJetpack(step, this.input.keyJetpack);
            if (jetpackExpired && this.jetpackManager) {
                this.jetpackManager.onPlayerJetpackExpired();
            }

            this.player.update(step, this.input, this.viewport.w);

            // Block storm cloud spawns directly above an active jetpack
            // pickup — the pickup auto-thrusts the panda straight up, so a
            // storm in that column is an unavoidable death.
            this._refreshForbiddenStormZones();

            this.clouds.update(step, this.camera.y, this.camera.ascent);
            this.bulletManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, true
            );
            this.kingBillManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, true
            );
            this.birdManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, true
            );
            this.jetpackManager.update(
                step, this.player, this.viewport, this.camera,
                true, this.player.jetpackActive
            );
            this.coinManager.update(
                step, this.player, this.camera, this.viewport,
                (cx, cy) => this._grantCoin(1, cx, cy)
            );
            // Smart-aim + click-to-fire raygun + resolve plasma-vs-enemy
            // hits. Run AFTER bullet/bird manager updates so the resolver
            // and the target picker both see current positions. Drain kill
            // events afterward so Game owns score/HUD bookkeeping.
            this.weaponSystem.update(
                step, this.player, this.input,
                this.bulletManager, this.kingBillManager, this.birdManager,
                this.particles, this.viewport, this.camera, true
            );
            for (const kill of this.weaponSystem.drainKills()) {
                this.score += kill.points;
                this._updateScoreHUD();
            }
            for (const shot of this.weaponSystem.drainShots()) {
                this._handleWeaponAudio(shot);
            }

            // Jetpack pickup: collect only if not already equipped.
            if (!this.player.jetpackActive
                && this.jetpackManager.jetpack.active
                && this.jetpackManager.jetpack.overlaps(this.player)) {
                this.player.equipJetpack();
                this.jetpackManager.jetpack.active = false;
                // Gold flourish on pickup — reuse spark burst for feedback.
                this.particles.spawnSparkBurst(this.player.x, this.player.y + this.player.height * 0.4, 16);
            }

            // While actively thrusting you can't stomp or land — you pass through
            // everything. Idle with jetpack equipped still behaves normally so
            // a quiet hover can catch a cloud.
            const thrustingNow = this.player._jetpackThrustingThisFrame;

            const bulletHit = this.bulletManager.checkInteraction(this.player);
            if (bulletHit) {
                if (!thrustingNow && bulletHit.type === 'stomp') this._stompBullet(bulletHit.bullet);
                else                                              this._strikeDeath(bulletHit.bullet);
            }

            // King Bill — never stompable; any overlap is a kill. Skipped if
            // a normal bullet already resolved this frame so we don't double
            // up _strikeDeath calls.
            let kingBillHit = null;
            if (!bulletHit) {
                kingBillHit = this.kingBillManager.checkInteraction(this.player);
                if (kingBillHit) this._strikeDeath(kingBillHit.bullet);
            }

            // Bird stomp-vs-head dispatch (only when bird is in 'flying' state).
            let birdInteracted = false;
            if (!bulletHit && !kingBillHit) {
                const bird = this.birdManager.bird;
                if (bird.active && bird.state === 'flying' && bird.overlaps(this.player)) {
                    birdInteracted = true;
                    if (!thrustingNow && bird.isStomp(this.player)) this._stompBird(bird);
                    else                                             this._strikeDeath(bird);
                }
            }

            // Storm-cloud touch from any side kills before we check for landings.
            let hazardHit = null;
            if (!bulletHit && !kingBillHit && !birdInteracted) {
                hazardHit = this.clouds.checkHazardCollision(this.player);
                if (hazardHit) this._strikeDeath(hazardHit);
            }

            // Normal cloud landing: skipped only while actually thrusting.
            const hit = (bulletHit || kingBillHit || birdInteracted || hazardHit || thrustingNow)
                ? null
                : this.clouds.checkCollision(this.player);
            if (hit) {
                if (hit.isHazard) {
                    this._strikeDeath(hit);
                } else {
                    const impactX = this.player.x;
                    const impactY = hit.hitboxTop;
                    this.player.landOn(hit);
                    hit.used = true;
                    this.cloudsJumped++;
                    this.score += 25;
                    this.particles.spawnPopup(hit.x, hit.y + hit.height * 0.2, 25);
                    // Bigger bounces throw more sparkles for visual reward.
                    const sparkCount = Math.round(8 + hit.springMult * 5);
                    this.particles.spawnSparkBurst(impactX, impactY, sparkCount);
                    if (!this.muted) {
                        // Volume ramps gently with altitude, with a small bonus
                        // for springy bounces. Kept well under full volume overall.
                        const altVolume = clamp(0.12 + (this.camera.ascent / 8000) * 0.28, 0.12, 0.40);
                        const springBonus = clamp((hit.springMult - 0.95) * 0.12, 0, 0.10);
                        this.jumpAudio.play(clamp(altVolume + springBonus, 0.05, 0.55));
                    }
                }
            }

            // Jetpack exhaust particles (fire + smoke, no stars).
            if (this.player.jetpackActive) this._emitJetpackExhaust(step);

            this.camera.follow(this.player.y, step);

            // Survival tick: +1 point every 250ms (4/sec) so the HUD always
            // ticks upward even when the player is cruising between clouds.
            this.survivalMs += step * (1000 / 60);
            while (this.survivalMs >= 250) {
                this.score += 1;
                this.survivalMs -= 250;
            }
            this._updateScoreHUD();
            this._updateFuelGauge();

            if (this.player.isFallenOff(this.camera.y, this.viewport.h)) {
                this._showGameOver();
            }
        } else if (this.state === 'dying') {
            // Player is frozen mid-strike; world keeps animating so the
            // electric crackle, storm clouds, and any in-flight bullets
            // (with their smoke trails) don't pop.
            this.clouds.update(step, this.camera.y, this.camera.ascent);
            this.bulletManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, false
            );
            this.kingBillManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, false
            );
            this.birdManager.update(
                step, this.player, this.camera.ascent,
                this.viewport, this.camera, this.particles, false
            );
            // Let in-flight plasma shots complete their arc; isPlaying=false
            // means no new shots are fired and any buffered click is dropped.
            // Score isn't awarded for kills during the dying frames.
            this.weaponSystem.update(
                step, this.player, this.input,
                this.bulletManager, this.kingBillManager, this.birdManager,
                this.particles, this.viewport, this.camera, false
            );
            this.weaponSystem.drainKills();   // discard mid-death kills
            this.weaponSystem.drainShots();   // and any mid-death shot SFX
            if (performance.now() - this.dyingAt >= 600) {
                this._showGameOver();
            }
        } else if (this.state === 'ready') {
            this.clouds.update(step, this.camera.y, 0);
        }
        // Particles always update so popups in flight finish even on game-over
        this.particles.update(step);

        // Decay the post-strike white flash overlay (~200ms to zero)
        if (this.flashT > 0) {
            this.flashT = Math.max(0, this.flashT - step / 12);
        }
    }

    _strikeDeath(target) {
        const panX = this.player.x;
        const panY = this.player.y + this.player.height * 0.5;

        if (target.isBullet) {
            // Cartoon boom engulfs the panda. Layered at three offsets so the
            // warm sparks/smoke cover more of the sprite than a single call.
            this.particles.spawnExplosion(panX, panY);
            this.particles.spawnExplosion(panX - 14, panY - 10);
            this.particles.spawnExplosion(panX + 14, panY + 6);
            // The bullet itself also detonates.
            this.particles.spawnExplosion(target.x, target.y);
            target.active = false;
        } else {
            // Electrical / avian hits — cool-blue sparkle burst on the panda.
            this.particles.spawnSparkBurst(panX, panY, 22);
            if (!target.isBird) {
                // Lightning bolt only for electrical hazards (storms).
                this.deathBolt = {
                    x1: target.x,
                    y1: target.hitboxTop,
                    x2: this.player.x,
                    y2: this.player.y + this.player.height + 30,
                    bornAt: performance.now()
                };
            }
        }
        // Dying with a jetpack equipped → remove it so the sprite + gauge reset.
        if (this.player.jetpackActive) {
            this.player.removeJetpack();
            this._updateFuelGauge();
        }
        this.flashT = 1;
        this.state = 'dying';
        this.dyingAt = performance.now();
        // End-of-run coin bonus — sqrt curve so a record run pays ~2x an
        // average one instead of ~10x. Added once per death (dying → gameover
        // state transition happens later, but _strikeDeath only fires once).
        const earned = Math.floor(Math.sqrt(Math.max(0, this.score)) * COIN_DEATH_BONUS_K);
        if (earned > 0) this._grantCoin(earned, null, null);
    }

    _stompBullet(bullet) {
        this.particles.spawnExplosion(bullet.x, bullet.y);
        this.particles.spawnPopup(bullet.x, bullet.y - 20, 100);
        // Normal cloud-bounce impulse (no spring multiplier).
        this.player.vy = PHYSICS.jumpVelocity;
        // Bullet stomps now recharge the air double-jump, same as a cloud landing.
        this.player.grantDoubleJump();
        this.score += 100;
        this._updateScoreHUD();
        bullet.active = false;
        if (!this.muted) {
            const altVolume = clamp(0.12 + (this.camera.ascent / 8000) * 0.28, 0.12, 0.40);
            this.jumpAudio.play(altVolume);
        }
    }

    _stompBird(bird) {
        // Big reward popup, no explosion — the tumble animation is the payoff.
        this.particles.spawnPopup(bird.x, bird.y - 20, 500);
        this.player.vy = PHYSICS.jumpVelocity;
        this.player.grantDoubleJump();
        this.score += 500;
        this._updateScoreHUD();
        bird.state = 'falling';
        bird.fallVy = -140;
        bird.fallGravity = 900;
        bird.fallRotSpeed = (Math.random() < 0.5 ? -1 : 1) * randRange(6, 11);
        if (!this.muted) {
            const altVolume = clamp(0.12 + (this.camera.ascent / 8000) * 0.28, 0.12, 0.40);
            this.jumpAudio.play(altVolume);
        }
    }

    _onDoubleJump() {
        const fx = this.player.x;
        const fy = this.player.feetY;
        this.particles.spawnSparkBurst(fx, fy, 6);
        for (let i = 0; i < 4; i++) {
            this.particles.spawnSmokePuff(
                fx + (Math.random() - 0.5) * 18,
                fy + (Math.random() - 0.5) * 6
            );
        }
        if (!this.muted) {
            const altVolume = clamp(0.10 + (this.camera.ascent / 8000) * 0.18, 0.10, 0.30);
            this.jumpAudio.play(altVolume);
        }
    }

    // Build a "no storm" forbidden zone around an item. Storm clouds can't
    // spawn directly above OR below the column for ~1.5 viewports each way;
    // sides outside `halfWidth` are unrestricted (storm can still spawn
    // there with margin). Used so a player auto-thrusting up from a jetpack
    // pickup — or approaching any future item — can't get killed by an
    // unavoidable storm in the same column.
    //
    // `item` only needs `{ x, y, height? }`. Pass any active pickup.
    _noStormZoneForItem(item) {
        const halfW = Math.max(140, this.viewport.w * 0.15);
        const itemH = item.height || 0;
        const reach = this.viewport.h * 1.5;
        return {
            x:         item.x,
            halfWidth: halfW,
            yMin:      item.y - reach,
            yMax:      item.y + itemH + reach
        };
    }

    _refreshForbiddenStormZones() {
        if (!this.clouds) return;
        const zones = [];
        // Jetpack pickup. Once collected or despawned the zone disappears.
        const j = this.jetpackManager && this.jetpackManager.jetpack;
        if (j && j.active) zones.push(this._noStormZoneForItem(j));
        // Future items: push their zones here, e.g.
        //   if (this.weaponPickup && this.weaponPickup.active)
        //       zones.push(this._noStormZoneForItem(this.weaponPickup));
        this.clouds.setForbiddenStormZones(zones);
    }

    _emitJetpackExhaust(step) {
        const ex = this.player.getJetpackExhaustPos();
        // Auto-thrust and user-held thrust both light up the exhaust — the
        // player object set this flag during tickJetpack.
        const thrusting = this.player._jetpackThrustingThisFrame;

        // Idle: a single grey puff every ~2-3 frames so the jetpack always
        // reads as "running" even when no thrust is happening.
        this._jetpackSmokeCooldown -= step;
        if (this._jetpackSmokeCooldown <= 0) {
            this.particles.spawnJetpackSmoke(ex.x, ex.y);
            this._jetpackSmokeCooldown = 2.5;
        }

        // Thrusting: continuous flame + extra smoke. Counts scale with step
        // so they stay roughly frame-rate independent.
        if (thrusting) {
            const flames = Math.max(2, Math.round(2 * step));
            for (let i = 0; i < flames; i++) {
                this.particles.spawnJetpackFlame(ex.x, ex.y);
            }
            this.particles.spawnJetpackSmoke(ex.x, ex.y);
        }
    }

    _updateFuelGauge() {
        const g = this.dom.fuelGauge;
        if (!g) return;
        if (!this.player || !this.player.jetpackActive) {
            g.classList.add('is-hidden');
            if (this.dom.btnJetpack) this.dom.btnJetpack.classList.remove('is-active');
            return;
        }
        g.classList.remove('is-hidden');
        if (this.dom.btnJetpack) this.dom.btnJetpack.classList.add('is-active');
        const pct = Math.round(this.player.jetpackFuel * 100);
        this.dom.fuelFill.style.height = pct + '%';
        this.dom.fuelLabel.textContent = pct + '%';
        const c = pct > 75 ? '#2ecc71'
                : pct > 50 ? '#f4c430'
                : pct > 25 ? '#e67e22'
                           : '#e74c3c';
        this.dom.fuelFill.style.background = c;
    }

    _render() {
        const { w, h } = this.viewport;
        const time = (performance.now() - this.startTime) / 1000;

        drawBackground(this.ctx, this.camera.y, this.camera.ascent, w, h, time, this.lastDt);
        this.clouds.render(this.ctx, this.camera.y, nightFactorAt(this.camera.ascent));
        if (this.jetpackManager) this.jetpackManager.render(this.ctx, this.camera.y);
        if (this.coinManager) this.coinManager.render(this.ctx, this.camera.y);
        if (this.player) this.player.render(this.ctx, this.camera.y, w);
        this.particles.render(this.ctx, this.camera.y);
        if (this.bulletManager) this.bulletManager.render(this.ctx, this.camera.y);
        // Plasma shots between bullets and KingBill — readable line of fire,
        // but the headline KingBill sprite still reads on top.
        if (this.weaponSystem) this.weaponSystem.render(this.ctx, this.camera.y);
        if (this.kingBillManager) this.kingBillManager.render(this.ctx, this.camera.y);
        if (this.birdManager) this.birdManager.render(this.ctx, this.camera.y);
        // Hit marker must draw AFTER all enemy sprites so it sits visibly on
        // top of them — otherwise KingBill / Bird sprites paint over it.
        if (this.weaponSystem) this.weaponSystem.renderHitMarker(this.ctx, this.camera.y, !!this.settings.showHitMarker);

        // Storm-strike death bolt (regenerated each frame so it flickers).
        if (this.deathBolt) {
            const age = performance.now() - this.deathBolt.bornAt;
            if (age < 500) {
                const alpha = clamp(1 - age / 500, 0, 1);
                const pts = makeBolt(
                    this.deathBolt.x1, this.deathBolt.y1,
                    this.deathBolt.x2, this.deathBolt.y2,
                    18
                );
                this.ctx.save();
                this.ctx.lineCap = 'round';
                this.ctx.lineJoin = 'round';
                this.ctx.beginPath();
                this.ctx.moveTo(pts[0].x, pts[0].y - this.camera.y);
                for (let i = 1; i < pts.length; i++) {
                    this.ctx.lineTo(pts[i].x, pts[i].y - this.camera.y);
                }
                this.ctx.strokeStyle = `rgba(170, 220, 255, ${(alpha * 0.55).toFixed(3)})`;
                this.ctx.lineWidth = 14;
                this.ctx.stroke();
                this.ctx.strokeStyle = `rgba(255, 255, 255, ${alpha.toFixed(3)})`;
                this.ctx.lineWidth = 5;
                this.ctx.stroke();
                this.ctx.restore();
            } else {
                this.deathBolt = null;
            }
        }

        // White screen flash from the lightning strike
        if (this.flashT > 0) {
            this.ctx.save();
            this.ctx.fillStyle = `rgba(255, 255, 255, ${(this.flashT * 0.85).toFixed(3)})`;
            this.ctx.fillRect(0, 0, w, h);
            this.ctx.restore();
        }
    }

    _updateScoreHUD() {
        this.dom.score.textContent = this.score;
    }

    _updateCoinHUD() {
        if (this.dom.coins) this.dom.coins.textContent = this.coins;
    }

    // Called by CoinManager on pickup AND by _strikeDeath for the run-end
    // bonus. `x,y` are where the popup appears — on pickup this is the coin
    // position; for the death bonus we pass null to skip the floating popup.
    _grantCoin(n, x, y) {
        if (n <= 0) return;
        this.coins += n;
        this.coinsEarnedThisRun += n;
        this._updateCoinHUD();
        if (x != null && y != null) {
            this.particles.spawnPopup(x, y - 20, n, COIN_POPUP_COLOR, 16);
        }
        // Cookie writes are cheap; no debounce needed given pickup cadence.
        saveCoinBalance(this.coins);
    }

    // Shop purchases go through here. Returns false (and leaves balance
    // untouched) when the player can't afford it. The same signed-HMAC
    // persistence path as _grantCoin — balance survives reloads.
    _spendCoins(n) {
        if (n <= 0) return true;
        if (this.coins < n) return false;
        this.coins -= n;
        this._updateCoinHUD();
        saveCoinBalance(this.coins);
        return true;
    }

    // Single source of truth for syncing the Player arm to settings state.
    // Called at boot (after Player is constructed) and from ShopUI after
    // every equip/unequip. Debug override: force-equip by flipping
    // ARM_DEFAULT_EQUIPPED=true + setting DEFAULT_EQUIPPED_WEAPON above.
    _applyEquippedWeapon() {
        if (!this.player) return;
        // Swap cancels any sustained-fire loop from the old weapon so it
        // doesn't keep playing while the new arm is shown.
        this._stopSustainedWeaponAudio();
        if (this.weaponSystem) this.weaponSystem._endFireCycle(true);
        let key = this.settings.equippedWeapon;
        if (ARM_DEFAULT_EQUIPPED && DEFAULT_EQUIPPED_WEAPON) key = DEFAULT_EQUIPPED_WEAPON;
        if (key && WEAPONS[key]) {
            const cfg = WEAPONS[key];
            this.player.equipWeapon(cfg, this.assets.images[cfg.spriteKey]);
        } else {
            this.player.unequipWeapon();
        }
    }

    // Route a single WeaponSystem audio event to the right output. Entry
    // shape: `{ mode, soundKey, volume }`. Missing `mode` = 'one-shot' for
    // backward compat with the per-shot SFX path used by every other
    // weapon. Muted state discards audio but still consumes the event so
    // sustained-state transitions (start/stop) stay balanced.
    _handleWeaponAudio(shot) {
        const mode = shot.mode || 'one-shot';
        if (mode === 'sustained-stop') {
            this._stopSustainedWeaponAudio();
            return;
        }
        if (this.muted) return;
        const audio = this.weaponAudio[shot.soundKey];
        if (!audio) return;
        const handle = audio.play(shot.volume);
        if (mode === 'sustained-start') {
            // Stop whatever was sustaining before so we don't leak audio
            // elements when the cycle restarts (e.g. overheat → resume).
            this._stopSustainedWeaponAudio();
            this.sustainedWeaponAudio = handle || null;
        }
    }

    _stopSustainedWeaponAudio() {
        const a = this.sustainedWeaponAudio;
        if (!a) return;
        try { a.pause(); a.currentTime = 0; } catch (_) { /* ignore */ }
        this.sustainedWeaponAudio = null;
    }

    _applyDpr() {
        const { w: logicalW, h: logicalH } = this.viewport;
        const dpr = this.dpr;
        const zoom = WORLD_ZOOM;
        // CSS size = logical * zoom = window.innerWidth/Height. This keeps
        // the canvas covering the full window regardless of zoom.
        const cssW = logicalW * zoom;
        const cssH = logicalH * zoom;
        this.canvas.width  = Math.round(cssW * dpr);
        this.canvas.height = Math.round(cssH * dpr);
        this.canvas.style.width  = cssW + 'px';
        this.canvas.style.height = cssH + 'px';
        // Combined transform: draw in logical coords, render at dpr*zoom per
        // logical px in the backing store.
        this.ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, 0, 0);
        this.ctx.imageSmoothingQuality = 'high';
    }

    handleResize() {
        const oldW = this.viewport.w;
        const oldH = this.viewport.h;
        // Re-derive the effective zoom from the baseline + new window
        // height — dragging to a 1440p monitor or hitting fullscreen
        // should adjust the zoom automatically so the world stays at a
        // consistent visual size.
        WORLD_ZOOM = effectiveWorldZoom(this.settings.zoom);
        this.viewport.w = window.innerWidth  / WORLD_ZOOM;
        this.viewport.h = window.innerHeight / WORLD_ZOOM;
        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        this._applyDpr();

        if (this.player) {
            this.player.x *= this.viewport.w / oldW;
            this.player.setHeight(Math.min(PLAYER_BASE_HEIGHT, this.viewport.h * PLAYER_MIN_VIEWPORT_RATIO));
        }
        if (this.clouds) this.clouds.setViewport(this.viewport.w, this.viewport.h);
        if (this.camera) this.camera.setViewport(this.viewport.h);
        if (this.birdManager) this.birdManager.setViewport(this.viewport.w, this.viewport.h, oldW, oldH);
        if (this.jetpackManager) this.jetpackManager.setViewport(this.viewport.w, this.viewport.h, oldW, oldH);
        if (this.coinManager) this.coinManager.setViewport(this.viewport.w, this.viewport.h, oldW, oldH);
    }

    _loadHighScore() {
        try {
            const v = localStorage.getItem(HIGHSCORE_KEY);
            return v ? (parseInt(v, 10) || 0) : 0;
        } catch (e) { return 0; }
    }

    _saveHighScore() {
        try { localStorage.setItem(HIGHSCORE_KEY, String(this.highscore)); } catch (e) { /* ignore */ }
    }

    _loadSettings() {
        try {
            const raw = localStorage.getItem(SETTINGS_KEY);
            if (!raw) return { ...DEFAULT_SETTINGS };
            const parsed = JSON.parse(raw);
            return { ...DEFAULT_SETTINGS, ...parsed };
        } catch (e) { return { ...DEFAULT_SETTINGS }; }
    }

    _saveSettings() {
        try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
    }

    _difficultyMods() {
        const d = this.settings.difficulty;
        if (d === 'easy') return {
            maxBullets: 1, bulletSpeedBase: 180, bulletSpeedCap: 340,
            bulletIntervalMult: 1.5, stormMult: 0.40, cloudWidthMult: 1.15,
            movingStormChanceMin: 0.05, movingStormChanceMax: 0.05, movingSpeedCap: 60,
            birdSpeedBase: 200, birdSpeedCap: 280, birdIntervalMin: 25, birdIntervalMax: 35,
            jetpackIntervalMin: 90, jetpackIntervalMax: 140,
            kingBillEnabled: false, kingBillIntervalMult: 1.0,
            missileEnabled: false, missileChanceMax: 0,
            kingBillMaxAlive: 1, missileMaxAlive: 1
        };
        if (d === 'hard') return {
            maxBullets: 4, bulletSpeedBase: 260, bulletSpeedCap: 600,
            bulletIntervalMult: 0.70, stormMult: 1.40, cloudWidthMult: 0.85,
            movingStormChanceMin: 0.25, movingStormChanceMax: 0.45, movingSpeedCap: 180,
            birdSpeedBase: 300, birdSpeedCap: 440, birdIntervalMin: 14, birdIntervalMax: 22,
            jetpackIntervalMin: 55, jetpackIntervalMax: 85,
            kingBillEnabled: true, kingBillIntervalMult: 0.7,
            missileEnabled: true, missileChanceMax: 0.80,
            // Hard-capped at one KingBill alive at any time — two is a
            // near-unfair spike. Missiles scale to two above the altitude
            // threshold, then three once the climb gets brutal so the
            // spawn rate visibly ramps with difficulty on Hard only.
            kingBillMaxAlive: 1,
            missileMaxAlive:  1, missileMaxAliveHigh:  3,
            spawnCapBoostAtPx: 12000
        };
        return {
            maxBullets: 3, bulletSpeedBase: 220, bulletSpeedCap: 460,
            bulletIntervalMult: 1.00, stormMult: 1.00, cloudWidthMult: 1.00,
            movingStormChanceMin: 0.25, movingStormChanceMax: 0.25, movingSpeedCap: 120,
            birdSpeedBase: 240, birdSpeedCap: 360, birdIntervalMin: 20, birdIntervalMax: 30,
            jetpackIntervalMin: 10, jetpackIntervalMax: 110,
            kingBillEnabled: true, kingBillIntervalMult: 1.0,
            missileEnabled: true, missileChanceMax: 0.40,
            kingBillMaxAlive: 1, missileMaxAlive: 1
        };
    }

    _applyDifficulty() {
        const mods = this._difficultyMods();
        if (this.bulletManager) this.bulletManager.difficulty = mods;
        if (this.kingBillManager) this.kingBillManager.difficulty = mods;
        if (this.birdManager)   this.birdManager.setDifficulty(mods);
        if (this.jetpackManager) this.jetpackManager.setDifficulty(mods);
        if (this.clouds) this.clouds.difficulty = mods;
    }

    _showSettings() {
        this.dom.ready.classList.add('is-hidden');
        this.dom.settings.classList.remove('is-hidden');
        this._refreshSettingsUI();
        if (window.gsap) {
            gsap.from(this.dom.settings.querySelector('.overlay__card'), {
                scale: 0.85, opacity: 0, duration: 0.3, ease: 'back.out(1.7)'
            });
        }
    }

    _hideSettings() {
        this.dom.settings.classList.add('is-hidden');
        this.dom.ready.classList.remove('is-hidden');
    }

    _refreshSettingsUI() {
        if (!this.dom || !this.dom.toggleDoubleJump) return;
        this.dom.toggleDoubleJump.setAttribute('aria-checked', this.settings.doubleJump ? 'true' : 'false');
        this.dom.toggleCursor.setAttribute('aria-checked', this.settings.hideCursor ? 'true' : 'false');
        if (this.dom.toggleHitMarker) {
            this.dom.toggleHitMarker.setAttribute('aria-checked', this.settings.showHitMarker ? 'true' : 'false');
        }
        for (const seg of this.dom.segmentedBtns) {
            const active = seg.dataset.difficulty === this.settings.difficulty;
            seg.setAttribute('aria-pressed', active ? 'true' : 'false');
        }
        if (this.dom.zoomSlider) {
            this.dom.zoomSlider.value = String(this.settings.zoom);
        }
        if (this.dom.zoomValue) {
            this.dom.zoomValue.textContent = this.settings.zoom.toFixed(2) + '×';
        }
        if (this.dom.sensitivitySlider) {
            this.dom.sensitivitySlider.value = String(this.settings.sensitivity);
        }
        if (this.dom.sensitivityValue) {
            this.dom.sensitivityValue.textContent = this.settings.sensitivity.toFixed(2) + '×';
        }
        if (this.dom.volumeSlider) {
            this.dom.volumeSlider.value = String(this.settings.volume);
        }
        if (this.dom.volumeValue) {
            this.dom.volumeValue.textContent = Math.round(this.settings.volume * 100) + '%';
        }
        // Pause-overlay mirrors of the volume slider — same source of truth,
        // stays in sync whether the player scrubs from Settings or Pause.
        if (this.dom.pauseVolumeSlider) {
            this.dom.pauseVolumeSlider.value = String(this.settings.volume);
        }
        if (this.dom.pauseVolumeValue) {
            this.dom.pauseVolumeValue.textContent = Math.round(this.settings.volume * 100) + '%';
        }
        if (this.dom.toggleMusic) {
            this.dom.toggleMusic.setAttribute(
                'aria-checked', this.settings.musicEnabled ? 'true' : 'false'
            );
        }
        if (this.dom.musicVolumeSlider) {
            this.dom.musicVolumeSlider.value = String(this.settings.musicVolume);
        }
        if (this.dom.musicVolumeValue) {
            this.dom.musicVolumeValue.textContent = Math.round(this.settings.musicVolume * 100) + '%';
        }
        // Music slider is inert when music is disabled or sound is globally
        // muted — the stored value stays put so flipping either back on
        // restores the previous level.
        const musicInert = !this.settings.musicEnabled || this.muted;
        if (this.dom.musicVolumeSlider) this.dom.musicVolumeSlider.disabled = musicInert;
        if (this.dom.musicVolumeValue)  this.dom.musicVolumeValue.classList.toggle('is-disabled', musicInert);
    }

    // Re-applies the world zoom: clamps, persists, recomputes viewport via
    // handleResize, and refreshes the settings UI's displayed value.
    // The slider value is the *baseline* (1080p-referenced) zoom; the
    // effective WORLD_ZOOM is derived in handleResize via
    // effectiveWorldZoom() so it stays correct on resize too.
    _applyZoom(value) {
        const z = clamp(value, ZOOM_MIN, ZOOM_MAX);
        if (z === this.settings.zoom) return;
        this.settings.zoom = z;
        WORLD_ZOOM = effectiveWorldZoom(z);
        this._saveSettings();
        this.handleResize();
        this._refreshSettingsUI();
    }

    // Horizontal movement sensitivity — scales ease factor + max-step cap.
    // Takes effect immediately (next frame) via the SENSITIVITY global.
    _applySensitivity(value) {
        const s = clamp(value, SENSITIVITY_MIN, SENSITIVITY_MAX);
        if (s === SENSITIVITY) return;
        SENSITIVITY = s;
        this.settings.sensitivity = s;
        this._saveSettings();
        this._refreshSettingsUI();
    }

    // Master volume (0..1) — applied through AudioPool's shared multiplier
    // so every SFX pool picks it up without extra wiring.
    _applyVolume(value) {
        const v = clamp(value, 0, 1);
        this.settings.volume = v;
        setMasterVolume(v);
        this._saveSettings();
        this._refreshSettingsUI();
    }

    // Music volume (0..1) — independent from the SFX master.
    _applyMusicVolume(value) {
        const v = clamp(value, 0, 1);
        this.settings.musicVolume = v;
        if (this.musicPlayer) this.musicPlayer.setVolume(v);
        this._saveSettings();
        this._refreshSettingsUI();
    }

    _loadMute() {
        try { return localStorage.getItem(MUTE_KEY) === 'true'; } catch (e) { return false; }
    }

    _saveMute() {
        try { localStorage.setItem(MUTE_KEY, this.muted ? 'true' : 'false'); } catch (e) { /* ignore */ }
    }

    toggleMute() {
        this.muted = !this.muted;
        this._saveMute();
        this._updateMuteUI();
        // Muting mid-cycle would otherwise leave the sustained loop
        // audible even though drain-events are discarded (HTMLAudio
        // playback isn't routed through the mute flag).
        if (this.muted) this._stopSustainedWeaponAudio();
        if (this.musicPlayer) this.musicPlayer.setMuted(this.muted);
        this._refreshSettingsUI();
    }

    _updateMuteUI() {
        if (!this.dom || !this.dom.btnMute) return;
        this.dom.muteLabel.textContent = this.muted ? 'Sound Off' : 'Sound On';
        this.dom.btnMute.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
        // Keep the Settings toggle in sync (checked = sound on, matches hotkey badge).
        if (this.dom.toggleSound) {
            this.dom.toggleSound.setAttribute('aria-checked', this.muted ? 'false' : 'true');
        }
        // Pause-overlay speaker icon — aria-pressed drives the CSS icon swap.
        if (this.dom.pauseMuteBtn) {
            this.dom.pauseMuteBtn.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
        }
        if (this.dom.settingsMuteBtn) {
            this.dom.settingsMuteBtn.setAttribute('aria-pressed', this.muted ? 'true' : 'false');
        }
        // Grey out the volume sliders when muted — the saved value is still
        // preserved (unmute restores it), but the slider shouldn't look
        // interactive while sound is off.
        if (this.dom.volumeSlider) this.dom.volumeSlider.disabled = this.muted;
        if (this.dom.pauseVolumeSlider) this.dom.pauseVolumeSlider.disabled = this.muted;
        if (this.dom.volumeValue) this.dom.volumeValue.classList.toggle('is-disabled', this.muted);
        if (this.dom.pauseVolumeValue) this.dom.pauseVolumeValue.classList.toggle('is-disabled', this.muted);
    }
}


// ============================================================
// Boot
// ============================================================

window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    game.start();
});
