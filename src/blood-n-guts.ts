/**
 * Documentation for Blood 'n Guts, a Foundry VTT module that adds blood splatter to your games.
 * All functionality is wrapped in it's main Class `BloodNGuts`.
 * @license [GNU GPLv3.0 & 'Commons Clause' License Condition v1.0]{@link https://github.com/edzillion/blood-n-guts/blob/master/LICENSE.md}
 * @packageDocumentation
 * @author [edzillion]{@link https://github.com/edzillion}
 */

import { registerSettings } from './module/settings';
import { preloadTemplates } from './module/preloadTemplates';
import { log, LogLevel } from './module/logging';
import {
  getRandomGlyph,
  computeSightFromPoint,
  drawDebugRect,
  getRandomBoxMuller,
  alignSplatsGetOffsetAndDimensions,
  getPointOnCurve,
  getUID,
} from './module/helpers';
import { MODULE_ID } from './constants';
import SplatToken from './module/SplatToken';

globalThis.sceneSplatPool = [];

//CONFIG.debug.hooks = true;
CONFIG.bng = { logLevel: 2 };

/**
 * Main class wrapper for all blood-n-guts features.
 * @class
 */
export class BloodNGuts {
  public static allFontsReady: Promise<any>;
  public static splatTokens: Record<string, SplatToken>;
  public static scenePool: Array<SplatPoolObject>;

  public static initialize(): void {
    BloodNGuts.splatTokens = {};
    BloodNGuts.scenePool = [];
  }

  /**
   * Generate splats on the floor beneath a token.
   * @category GMOnly
   * @function
   * @param {Token} token - the token to generate splats for.
   * @param {SplatFont} font - the font to use for splats.
   * @param {number} size - the size of splats.
   * @param {number} density - the amount of splats.
   * @param {number} severity - more and bigger splats based on the severity of the wound.
   */
  public static splatFloor(
    splatToken: SplatToken,
    font: SplatFont,
    size: number,
    density: number,
  ): Promise<Entity<PlaceableObject>> {
    if (!density) return;
    log(LogLevel.INFO, 'splatFloor');

    const splatStateObj: Partial<SplatStateObject> = {};

    // scale the splats based on token size and severity
    const fontSize = Math.round(
      size * ((splatToken.spriteWidth + splatToken.spriteWidth) / canvas.grid.size / 2) * splatToken.hitSeverity,
    );
    log(LogLevel.DEBUG, 'splatFloor fontSize', fontSize);
    splatStateObj.styleData = {
      fontFamily: font.name,
      fontSize: fontSize,
      fill: splatToken.bloodColor,
      align: 'center',
    };
    const style = new PIXI.TextStyle(splatStateObj.styleData);

    // amount of splats is based on density and severity
    const amount = Math.round(density * splatToken.hitSeverity);
    // get a random glyph and then get a random (x,y) spread away from the token.
    const glyphArray: Array<string> = Array.from({ length: amount }, () => getRandomGlyph(font));
    const pixelSpreadX = splatToken.spriteWidth * game.settings.get(MODULE_ID, 'splatSpread');
    const pixelSpreadY = splatToken.spriteHeight * game.settings.get(MODULE_ID, 'splatSpread');
    log(LogLevel.DEBUG, 'splatFloor amount', amount);
    log(LogLevel.DEBUG, 'splatFloor pixelSpread', pixelSpreadX, pixelSpreadY);

    // create our splats for later drawing.
    splatStateObj.splats = glyphArray.map((glyph) => {
      const tm = PIXI.TextMetrics.measureText(glyph, style);
      const randX = getRandomBoxMuller() * pixelSpreadX - pixelSpreadX / 2;
      const randY = getRandomBoxMuller() * pixelSpreadY - pixelSpreadY / 2;
      return {
        x: Math.round(randX - tm.width / 2),
        y: Math.round(randY - tm.height / 2),
        width: tm.width,
        height: tm.height,
        glyph: glyph,
      };
    });

    const { offset, width, height } = alignSplatsGetOffsetAndDimensions(splatStateObj.splats);
    splatStateObj.offset = offset;
    splatStateObj.x = offset.x;
    splatStateObj.y = offset.y;

    const maxDistance = Math.max(width, height);
    const sight = computeSightFromPoint(splatToken.token.center, maxDistance);

    // since we don't want to add the mask to the splatsContainer yet (as that will
    // screw up our alignment) we need to move it by editing the x,y points directly
    for (let i = 0; i < sight.length; i += 2) {
      sight[i] -= splatStateObj.offset.x;
      sight[i + 1] -= splatStateObj.offset.y;
    }

    splatStateObj.x += splatToken.token.center.x;
    splatStateObj.y += splatToken.token.center.y;

    splatStateObj.maskPolygon = sight;

    splatStateObj.id = getUID();
    this.scenePool.push({ state: <SplatStateObject>splatStateObj });
    //return BloodNGuts.addToSplatPool(<SplatStateObject>splatStateObj);
  }

  /**
   * Generate splats in a trail on the floor behind a moving token.
   * @category GMOnly
   * @function
   * @param {Token} token - the token to generate splats for.
   * @param {SplatFont} font - the font to use for splats.
   * @param {number} size - the size of splats.
   * @param {number} density - the amount of splats.
   * @param {number} severity - more and bigger splats based on the severity of the wound.
   */
  public static splatTrail(
    splatToken: SplatToken,
    font: SplatFont,
    size: number,
    density: number,
  ): Promise<Entity<PlaceableObject>> {
    if (!density) return;
    log(LogLevel.INFO, 'splatTrail');
    log(LogLevel.DEBUG, 'splatTrail severity', splatToken.bleedingSeverity);

    const splatStateObj: Partial<SplatStateObject> = {};

    // scale the splats based on token size and severity
    const fontSize = Math.round(
      size * ((splatToken.spriteWidth + splatToken.spriteHeight) / canvas.grid.size / 2) * splatToken.bleedingSeverity,
    );
    log(LogLevel.DEBUG, 'splatTrail fontSize', fontSize);
    splatStateObj.styleData = {
      fontFamily: font.name,
      fontSize: fontSize,
      fill: splatToken.bloodColor,
      align: 'center',
    };
    const style = new PIXI.TextStyle(splatStateObj.styleData);

    const origin = new PIXI.Point(0);
    const trailOrigin = new PIXI.Point(
      -splatToken.direction.x * canvas.grid.size,
      -splatToken.direction.y * canvas.grid.size,
    );

    log(LogLevel.DEBUG, 'splatTrail origin,trailOrigin', origin, trailOrigin);

    //horiz or vert movement
    const pixelSpread = splatToken.direction.x
      ? splatToken.spriteWidth * game.settings.get(MODULE_ID, 'splatSpread') * 2
      : splatToken.spriteHeight * game.settings.get(MODULE_ID, 'splatSpread') * 2;

    const rand = getRandomBoxMuller() * pixelSpread - pixelSpread / 2;
    log(LogLevel.DEBUG, 'splatTrail rand', rand);
    // first go half the distance in the direction we are going
    const controlPt: PIXI.Point = new PIXI.Point(
      trailOrigin.x + splatToken.direction.x * (canvas.grid.size / 2),
      trailOrigin.y + splatToken.direction.y * (canvas.grid.size / 2),
    );
    // then swap direction y,x to give us an position to the side
    controlPt.set(controlPt.x + splatToken.direction.y * rand, controlPt.y + splatToken.direction.x * rand);
    log(LogLevel.DEBUG, 'splatTrail spread, ctrlPt', rand, controlPt);

    // get random glyphs and the interval between each splat
    // amount is based on density and severity
    const amount = Math.round(density * splatToken.bleedingSeverity);
    const glyphArray: Array<string> = Array.from({ length: amount }, () => getRandomGlyph(font));
    const increment = 1 / amount;
    log(LogLevel.DEBUG, 'splatTrail amount', amount);

    // we skip 0 because that position already has a splat from the last trailSplat/floorSplat
    let dist = increment;
    // create our splats for later drawing.
    splatStateObj.splats = glyphArray.map((glyph) => {
      const tm = PIXI.TextMetrics.measureText(glyph, style);
      const pt = getPointOnCurve(trailOrigin, controlPt, origin, dist);
      dist += increment;
      return {
        x: Math.round(pt.x - tm.width / 2),
        y: Math.round(pt.y - tm.height / 2),
        width: tm.width,
        height: tm.height,
        glyph: glyph,
      };
    });
    log(LogLevel.DEBUG, 'splatTrail splatStateObj.splats', splatStateObj.splats);

    const { offset, width, height } = alignSplatsGetOffsetAndDimensions(splatStateObj.splats);

    splatStateObj.offset = offset;
    splatStateObj.x = offset.x;
    splatStateObj.y = offset.y;

    const maxDistance = Math.max(width, height);
    const sight = computeSightFromPoint(splatToken.token.center, maxDistance);
    splatStateObj.maskPolygon = sight;

    // since we don't want to add the mask to the splatsContainer yet (as that will
    // screw up our alignment) we need to move it by editing the x,y points directly
    for (let i = 0; i < sight.length; i += 2) {
      sight[i] -= splatStateObj.offset.x;
      sight[i + 1] -= splatStateObj.offset.y;
    }

    splatStateObj.x += splatToken.token.center.x;
    splatStateObj.y += splatToken.token.center.y;

    splatStateObj.id = getUID();
    this.scenePool.push({ state: <SplatStateObject>splatStateObj });
    //return BloodNGuts.addToSplatPool(<SplatStateObject>splatStateObj);
  }

  private static drawSplatPool(updatedState) {
    const updatedStateIds = updatedState.map((s) => s.id);
    log(LogLevel.DEBUG, 'updatePool updatedStateIds', updatedStateIds);

    const oldStateIds = this.scenePool.map((poolObj) => poolObj.state.id);
    log(LogLevel.DEBUG, 'updatePool oldStateIds', oldStateIds);

    const addStates = updatedState.filter((state) => !oldStateIds.includes(state.id) && !state.tokenId);
    log(LogLevel.DEBUG, 'updatePool addIds', addStates);

    // addstateObjects are stateObjs that are not yet in the splat pool
    if (addStates) {
      addStates.forEach((state) => {
        const splatsContainer = new PIXI.Container();
        const style = new PIXI.TextStyle(state.styleData);
        // if it's maskPolygon type we can create a sightMask directly.
        if (state.maskPolygon) {
          state.splats.forEach((splat) => {
            const text = new PIXI.Text(splat.glyph, style);
            text.x = splat.x;
            text.y = splat.y;
            splatsContainer.addChild(text);
            return text;
          });

          log(LogLevel.DEBUG, 'drawSplats: splatStateObj.maskPolygon');
          const sightMask = new PIXI.Graphics();
          sightMask.beginFill(1, 1);
          sightMask.drawPolygon(state.maskPolygon);
          sightMask.endFill();

          splatsContainer.addChild(sightMask);
          splatsContainer.mask = sightMask;

          splatsContainer.x = state.x;
          splatsContainer.y = state.y;

          canvas.tiles.addChild(splatsContainer);
          this.scenePool.push({ state: state, splatsContainer: splatsContainer });
        } else log(LogLevel.ERROR, 'drawSplats: splatStateObject has no .maskPolygon!');
      });
    }
  }

  private static trimSplatPool() {
    log(LogLevel.INFO, 'trimSplatPool');

    const maxPoolSize = game.settings.get(MODULE_ID, 'sceneSplatPoolSize');
    const fadedPoolSize = Math.floor(this.scenePool.length * 0.15);
    const veryFadedPoolSize = Math.ceil(fadedPoolSize * 0.33);
    log(LogLevel.DEBUG, 'trimSplatPool sizes curr, max', this.scenePool.length, maxPoolSize);

    if (this.scenePool.length >= maxPoolSize) {
      // remove the oldest splat
      const removePoolObj = this.scenePool.shift();
      log(LogLevel.DEBUG, 'fadingSplatPool destroying id', removePoolObj.state.id);
      if (removePoolObj.state.tokenId)
        this.splatTokens[removePoolObj.state.tokenId].removeState(removePoolObj.state.id);
      else removePoolObj.splatsContainer.destroy({ children: true });
    }

    // 15% of splats will be set to fade. 1/3rd of those will be very faded
    if (this.scenePool.length >= fadedPoolSize) {
      const size = Math.min(fadedPoolSize, this.scenePool.length);
      for (let i = 0; i < size; i++) {
        const alpha = i < veryFadedPoolSize ? 0.1 : 0.3;
        BloodNGuts.scenePool[i].splatsContainer.alpha = alpha;
      }
    }

    log(
      LogLevel.DEBUG,
      `addToSplatPool sceneSplatPool:${globalThis.sceneSplatPool.length}, fadedPoolSize:${fadedPoolSize}, veryFadedPoolSize:${veryFadedPoolSize}`,
    );
  }

  /**
   * Draw splats to the canvas from it's state object and return a reference to the `PIXI.Container` that holds them.
   * @category GMOnly
   * @function
   * @param {SplatStateObject} splatStateObject - the splats data.
   * @returns {PIXI.Container} - the canvas reference.
   */
  private static drawSplats(splatStateObject: SplatStateObject): void {
    log(LogLevel.INFO, 'drawSplats');
    log(LogLevel.DEBUG, 'drawSplats: splatStateObject', splatStateObject);
    const splatsContainer = new PIXI.Container();
    const style = new PIXI.TextStyle(splatStateObject.styleData);
    // if it's maskPolygon type we can create a sightMask directly.
    if (splatStateObject.maskPolygon) {
      splatStateObject.splats.forEach((splat) => {
        const text = new PIXI.Text(splat.glyph, style);
        text.x = splat.x;
        text.y = splat.y;
        splatsContainer.addChild(text);
        return text;
      });

      log(LogLevel.DEBUG, 'drawSplats: splatStateObj.maskPolygon');
      const sightMask = new PIXI.Graphics();
      sightMask.beginFill(1, 1);
      sightMask.drawPolygon(splatStateObject.maskPolygon);
      sightMask.endFill();

      splatsContainer.addChild(sightMask);
      splatsContainer.mask = sightMask;

      splatsContainer.x = splatStateObject.x;
      splatsContainer.y = splatStateObject.y;

      canvas.tiles.addChild(splatsContainer);
      this.addToSplatPool(splatStateObject, splatsContainer);
    } else log(LogLevel.ERROR, 'drawSplats: splatStateObject has no .maskPolygon!');

    if (CONFIG.bng.logLevel > LogLevel.DEBUG) drawDebugRect(splatsContainer);
  }

  /**
   * Adds the token data and a reference to the token on the canvas to our pool. The pool is a FIFO stack with
   * maximum size `blood-n-guts.sceneSplatPoolSize`. When size is exceeded the oldest entries are destroyed.
   * 15% of the oldest splats are set to fade (alpha 0.3) and the oldest 1/3 of those are set to very faded (alpha 0.1)
   * @category GMOnly
   * @function
   * @param {SplatStateObject} splatStateObj - token data to add.
   */
  public static addToSplatPool(splatStatObj, splatsContainer = null): Promise<Entity> {
    log(LogLevel.INFO, 'addToSplatPool', splatsContainer);

    // if splatsContainer is null we will draw it and add the container on the next updateSceneHandler
    const poolObj = { state: splatStatObj, splatsContainer: splatsContainer };
    //add the new splat
    this.scenePool.push(poolObj);
    if (poolObj.splatsContainer === null) return;

    const maxPoolSize = game.settings.get(MODULE_ID, 'sceneSplatPoolSize');
    const fadedPoolSize = Math.floor(this.scenePool.length * 0.15);
    const veryFadedPoolSize = Math.ceil(fadedPoolSize * 0.33);
    log(LogLevel.DEBUG, 'addToSplatPool sizes curr, max', this.scenePool.length, maxPoolSize);

    if (this.scenePool.length >= maxPoolSize) {
      // remove the oldest splat
      const removePoolObj = this.scenePool.shift();
      log(LogLevel.DEBUG, 'fadingSplatPool destroying id', removePoolObj.state.id);
      if (removePoolObj.state.tokenId)
        this.splatTokens[removePoolObj.state.tokenId].removeState(removePoolObj.state.id);
      else removePoolObj.splatsContainer.destroy({ children: true });
    }

    // 15% of splats will be set to fade. 1/3rd of those will be very faded
    if (globalThis.sceneSplatPool.length >= fadedPoolSize) {
      const size = Math.min(fadedPoolSize, globalThis.sceneSplatPool.length);
      for (let i = 0; i < size; i++) {
        const alpha = i < veryFadedPoolSize ? 0.1 : 0.3;
        BloodNGuts.scenePool[i].splatsContainer.alpha = alpha;
      }
    }

    log(
      LogLevel.DEBUG,
      `addToSplatPool sceneSplatPool:${globalThis.sceneSplatPool.length}, fadedPoolSize:${fadedPoolSize}, veryFadedPoolSize:${veryFadedPoolSize}`,
    );
  }

  /**
   * Loads all `SplatStateObject`s from scene flag `splatState` and draws them - this
   * will also add them back into the pool.
   * @category GMOnly
   * @function
   */
  private static async setupScene(): Promise<void> {
    let stateObjects = canvas.scene.getFlag(MODULE_ID, 'splatState');
    log(LogLevel.INFO, 'setupScene stateObjects loaded:', stateObjects);

    if (stateObjects) {
      log(LogLevel.INFO, 'setupScene drawSplats', canvas.scene.name);
      const extantTokens = Object.keys(BloodNGuts.splatTokens);
      stateObjects = stateObjects.filter((so) => !so.tokenId || extantTokens.includes(so.tokenId));
      // draw each missing splatsContainer and save a reference to it in the pool.
      // if the splatPoolSize has changed then we want to add only the latest

      this.drawSplatPool(stateObjects);
      this.trimSplatPool();
    }
  }

  public static saveState(): Promise<Entity> {
    const splatState = this.scenePool.map((p) => p.state);

    return canvas.scene.setFlag(MODULE_ID, 'splatState', splatState);
  }

  /**
   * Wipes all splats from the current scene and empties all pools.
   * @category GMOnly
   * @function
   */
  public static wipeSceneSplats(): void {
    log(LogLevel.INFO, 'wipeSceneSplats');
    canvas.scene.setFlag(MODULE_ID, 'splatState', null);

    // destroy scene splats
    globalThis.sceneSplatPool.forEach((poolObj) => {
      if (!poolObj.state.tokenId) poolObj.splatsContainer.destroy();
    });

    // destroy token splats
    for (const tokenId in BloodNGuts.splatTokens) {
      const splatToken = BloodNGuts.splatTokens[tokenId];
      splatToken.wipeAll();
    }
    globalThis.sceneSplatPool = [];
  }

  /**
   * Handler called on all updateToken and updateActor events. Checks for movement and damage and
   * calls splat generate methods.
   * @category GMOnly
   * @function
   * @async
   * @param {scene} - reference to the current scene
   * @param {tokenData} - tokenData of updated Token/Actor
   * @param {changes} - changes
   */
  public static async updateTokenOrActorHandler(scene, tokenData, changes): Promise<void> {
    if (!scene.active || !game.user.isGM) return;
    log(LogLevel.INFO, 'updateTokenOrActorHandler', changes);
    const tokenId = tokenData._id || tokenData.data._id;
    const splatToken = BloodNGuts.splatTokens[tokenId];
    splatToken.updateChanges(changes);
  }

  /**
   * Handler called when canvas has been fully loaded. Wipes state data and reloads from flags.
   * @category GMOnly
   * @function
   * @param {scene} - reference to the current scene
   * @param {tokenData} - tokenData of updated Token/Actor
   * @param {changes} - changes
   */
  public static canvasReadyHandler(canvas): void {
    if (!canvas.scene.active) return;
    log(LogLevel.INFO, 'canvasReady, active:', canvas.scene.name);

    //canvas.scene.setFlag(MODULE_ID, 'sceneSplatPool', null);

    // wipe pools to be refilled from scene flag data
    globalThis.sceneSplatPool = [];

    // need to wait on fonts loading before we can setupScene
    BloodNGuts.allFontsReady.then(() => {
      BloodNGuts.setupScene();
    });
  }

  /**
   * Handler called when scene data updated. Draws splats from scene data flags.
   * @category GMandPC
   * @function
   * @param {scene} - reference to the current scene
   * @param {changes} - changes
   */
  public static updateSceneHandler(scene, changes): void {
    if (!scene.active || !this.scenePool) return;

    if (changes.flags[MODULE_ID]?.splatState === null) {
      if (game.user.isRole(CONST.USER_ROLES.PLAYER)) BloodNGuts.wipeSceneSplats();
      return;
    } else if (!changes.flags[MODULE_ID]?.splatState) return;
    log(LogLevel.INFO, 'updateSceneHandler');

    this.drawSplatPool(changes.flags[MODULE_ID]?.splatState);
    this.trimSplatPool();
  }

  /**
   * Handler called when left button bar is drawn
   * @category GMOnly
   * @function
   * @param {buttons} - reference to the buttons controller
   */
  public static getSceneControlButtonsHandler(buttons) {
    log(LogLevel.INFO, 'getSceneControlButtonsHandler');
    const tileButtons = buttons.find((b) => b.name == 'tiles');

    if (tileButtons) {
      tileButtons.tools.push({
        name: 'wipe',
        title: 'Wipe all blood splats from this scene.',
        icon: 'fas fa-tint-slash',
        active: true,
        visible: true,
        onClick: BloodNGuts.wipeSceneSplats,
      });
    }
  }

  /**
   * Handler called when token is deleted. Removed tokenSplats and state for this token.
   * @category GMOnly
   * @function
   * @param {buttons} - reference to the buttons controller
   */
  public static async deleteTokenHandler(scene, token) {
    // perhaps this is not scene agnostic
    if (!game.user.isGM) return;
    log(LogLevel.INFO, 'deleteTokenHandler', token);
    //todo: remove states from tracker here
  }
}

// Hooks
Hooks.once('init', async () => {
  log(LogLevel.INFO, `Initializing module ${MODULE_ID}`);

  // Assign custom classes and constants here
  BloodNGuts.initialize();
  // Register custom module settings
  registerSettings();

  (document as any).fonts.load('12px splatter');
  (document as any).fonts.load('12px WC Rhesus A Bta');

  BloodNGuts.allFontsReady = (document as any).fonts.ready;

  // Preload Handlebars templates
  await preloadTemplates();
  // Register custom sheets (if any)
});

Hooks.once('setup', () => {
  // Do anything after initialization but before
  // ready
  log(LogLevel.INFO, 'setup Hook');
});

Hooks.once('ready', () => {
  log(LogLevel.INFO, 'ready');
});

Hooks.on('canvasInit', (canvas) => {
  log(LogLevel.INFO, 'canvasInit', canvas.scene.name);
  if (!canvas.scene.active) log(LogLevel.INFO, 'canvasInit, skipping inactive scene');
});

Hooks.on('canvasReady', BloodNGuts.canvasReadyHandler);

Hooks.on('updateToken', BloodNGuts.updateTokenOrActorHandler);
Hooks.on('updateActor', (actor, changes) => {
  if (!canvas.scene.active || !game.user.isGM) return;
  // convert into same structure as token changes.
  if (changes.data) changes.actorData = { data: changes.data };
  const token = canvas.tokens.placeables.filter((t) => t.actor).find((t) => t.actor.id === actor.id);
  if (!token) log(LogLevel.ERROR, 'updateActor token not found!');
  else BloodNGuts.updateTokenOrActorHandler(canvas.scene, token.data, changes);
});

Hooks.on('deleteToken', BloodNGuts.deleteTokenHandler);

Hooks.on('updateScene', BloodNGuts.updateSceneHandler);
Hooks.on('getSceneControlButtons', BloodNGuts.getSceneControlButtonsHandler);

Token.prototype.draw = (function () {
  const cached = Token.prototype.draw;
  return async function () {
    await cached.apply(this);
    if (!this.icon) return this;
    if (!BloodNGuts.splatTokens[this.id]) {
      BloodNGuts.splatTokens[this.id] = new SplatToken(this);
      await BloodNGuts.splatTokens[this.id].createMask();
    }
    const splatToken = BloodNGuts.splatTokens[this.id];
    const splatContainerZIndex = this.children.findIndex((child) => child === this.icon) + 1;
    if (splatContainerZIndex === 0) log(LogLevel.ERROR, 'draw(), cant find token.icon!');
    else {
      this.addChildAt(splatToken.splatsContainer, splatContainerZIndex);
      splatToken.draw();
      return this;
    }
  };
})();
