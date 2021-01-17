/* eslint-disable @typescript-eslint/ban-ts-comment */
// import { FXCanvasAnimation } from '../module/canvasanimation.js';
// import { easeFunctions } from '../module/ease.js';

import { BloodNGuts } from '../blood-n-guts';
import { MODULE_ID } from '../constants';
import {
  alignSplatsGetOffsetAndDimensions,
  computeSightFromPoint,
  getRandomBoxMuller,
  getRandomGlyph,
  getRGBA,
  getUID,
} from './helpers';
import { log, LogLevel } from './logging';
import Splat from './Splat';

// @ts-ignore
export default class BloodLayer extends CanvasLayer {
  dragging: boolean;
  brushing: boolean;
  lock: boolean;
  layername: string;
  historyBuffer: any[];
  pointer: number;
  gridLayout: any;
  dragStart: { x: number; y: number };
  history: any[];
  BRUSH_TYPES: { ELLIPSE: number; BOX: number; ROUNDED_RECT: number; POLYGON: number };
  DEFAULTS: { visible: boolean; blurQuality: number; blurRadius: number };
  op: any;
  activeTool: any;
  layer: PIXI.Container;
  blur: PIXI.filters.BlurFilter;
  maskTexture: any;
  boxPreview: any;
  // _objects: [];
  constructor() {
    super();
    this.lock = false;
    this.layername = 'blood';
    this.historyBuffer = [];
    this.pointer = 0;
    this.gridLayout = {};
    this.dragStart = { x: 0, y: 0 };
    // Not actually used, just to prevent foundry from complaining
    this.history = [];
    this.BRUSH_TYPES = {
      ELLIPSE: 0,
      BOX: 1,
      ROUNDED_RECT: 2,
      POLYGON: 3,
    };
    this.DEFAULTS = {
      visible: false,
      blurQuality: 2,
      blurRadius: 5,
    };

    this._registerMouseListeners();
  }

  /**
   * Adds the mouse listeners to the layer
   */
  _registerMouseListeners() {
    this.addListener('pointerdown', this._pointerDown);
    this.addListener('pointerup', this._pointerUp);
    this.addListener('pointermove', this._pointerMove);
    this.dragging = false;
    this.brushing = false;
  }

  /** @override */
  static get layerOptions() {
    //@ts-expect-error
    return mergeObject(super.layerOptions, {
      // @ts-ignore
      zIndex: 11,
      canDragCreate: false,
      objectClass: Splat,
      sortActiveTop: false,
      rotatableObjects: true,
      sheetClass: TileConfig,
    });
  }

  /**
   * Called on canvas init, creates the canvas layers and various objects and registers listeners
   *
   * Important objects:
   *
   * layer       - PIXI Sprite which holds all the mask elements
   * filters     - Holds filters such as blur applied to the layer
   * layer.mask  - PIXI Sprite wrapping the renderable mask
   * maskTexture - renderable texture that holds the actual mask data
   */
  async init() {
    // Check if masklayer is flagged visible
    // let v = this.getSetting('visible');
    // if (v === undefined) v = false;
    // this.visible = v;

    // The layer is the primary sprite to be displayed
    this.layer = BloodLayer.getCanvasContainer();
    this.addChild(this.layer);
    // this.setTint(this.getTint());
    // this.setAlpha(this.getAlpha(), true);

    // Filters
    // this.blur = new PIXI.filters.BlurFilter();
    // this.blur.padding = 0;
    // this.blur.repeatEdgePixels = true;
    // this.blur.blur = this.getSetting('blurRadius');
    // this.blur.quality = this.getSetting('blurQuality');
    // this.filters = [this.blur];

    // this.maskTexture = MaskLayer.getMaskTexture();
    // this.layer.mask = new PIXI.Sprite(this.maskTexture);
    // this.addChild(this.layer.mask);
    // this.setFill();

    // Allow zIndex prop to function for items on this layer
    this.sortableChildren = true;

    // Render initial history stack
    this.renderStack();
  }

  /**
   * Renders the history stack to the mask
   * @param history {Array}       A collection of history events
   * @param start {Number}        The position in the history stack to begin rendering from
   * @param start {Number}        The position in the history stack to stop rendering
   */
  renderStack(
    history = canvas.scene.getFlag(this.layername, 'history'),
    start = this.pointer,
    stop = canvas.scene.getFlag(this.layername, 'history.pointer'),
  ): void {
    // If history is blank, do nothing
    if (history === undefined) return;
    // If history is zero, reset scene fog
    if (history.events.length === 0) log(LogLevel.INFO, `history empty`); //this.resetLayer(false);
    if (start === undefined) start = 0;
    if (stop === undefined) stop = history.events.length;
    // If pointer preceeds the stop, reset and start from 0
    if (stop <= this.pointer) {
      log(LogLevel.INFO, `stop <= pointer`);
      //this.resetLayer(false);
      start = 0;
    }

    log(LogLevel.INFO, `Rendering from: ${start} to ${stop}`);
    // Render all ops starting from pointer
    for (let i = start; i < stop; i += 1) {
      for (let j = 0; j < history.events[i].length; j += 1) {
        this.renderBrush(history.events[i][j], false);
      }
    }
    // Update local pointer
    this.pointer = stop;
    // Prevent calling update when no lights loaded
    if (!canvas.sight?.light?.los?.geometry) return;
    // Update sight layer
    canvas.sight.update();
  }

  /**
   * Add buffered history stack to scene flag and clear buffer
   */
  async commitHistory() {
    // Do nothing if no history to be committed, otherwise get history
    if (this.historyBuffer.length === 0) return;
    if (this.lock) return;
    this.lock = true;
    let history = canvas.scene.getFlag(this.layername, 'history');
    // If history storage doesnt exist, create it
    if (!history) {
      history = {
        events: [],
        pointer: 0,
      };
    }
    // If pointer is less than history length (f.x. user undo), truncate history
    history.events = history.events.slice(0, history.pointer);
    // Push the new history buffer to the scene
    history.events.push(this.historyBuffer);
    history.pointer = history.events.length;
    await canvas.scene.unsetFlag(this.layername, 'history');
    await canvas.scene.setFlag(this.layername, 'history', history);
    log(LogLevel.INFO, `Pushed ${this.historyBuffer.length} updates.`);
    // Clear the history buffer
    this.historyBuffer = [];
    this.lock = false;
  }

  /**
   * Resets the layer
   * @param save {Boolean} If true, also resets the layer history
   */
  async resetLayer(save = true) {
    // Fill fog layer with solid
    // this.setFill();
    // If save, also unset history and reset pointer
    if (save) {
      await canvas.scene.unsetFlag(this.layername, 'history');
      await canvas.scene.setFlag(this.layername, 'history', { events: [], pointer: 0 });
      this.pointer = 0;
    }
  }

  /**
   * Wipes the layer contents
   * @param save {Boolean} If true, also resets the layer history
   */
  async wipeLayer(save = true) {
    // Fill fog layer with solid
    // this.setFill();
    // If save, also unset history and reset pointer
    if (save) {
      await canvas.scene.unsetFlag(this.layername, 'history');
      await canvas.scene.setFlag(this.layername, 'history', { events: [], pointer: 0 });
      this.pointer = 0;
    }
  }

  /**
   * Steps the history buffer back X steps and redraws
   * @param steps {Integer} Number of steps to undo, default 1
   */
  async undo(steps = 1) {
    log(LogLevel.INFO, `Undoing ${steps} steps.`);
    // Grab existing history
    // Todo: this could probably just grab and set the pointer for a slight performance improvement
    let history = canvas.scene.getFlag(this.layername, 'history');
    if (!history) {
      history = {
        events: [],
        pointer: 0,
      };
    }
    let newpointer = this.pointer - steps;
    if (newpointer < 0) newpointer = 0;
    // Set new pointer & update history
    history.pointer = newpointer;
    await canvas.scene.unsetFlag(this.layername, 'history');
    await canvas.scene.setFlag(this.layername, 'history', history);
  }

  /**
   * Creates a PIXI graphic using the given brush parameters
   * @param data {Object}       A collection of brush parameters
   * @returns {Object}          PIXI.Graphics() instance
   *
   * @example
   * const myBrush = this.brush({
   *      shape: "ellipse",
   *      x: 0,
   *      y: 0,
   *      fill: 0x000000,
   *      width: 50,
   *      height: 50,
   *      alpha: 1,
   *      visible: true
   * });
   */
  brush(data) {
    // Get new graphic & begin filling
    const alpha = typeof data.alpha === 'undefined' ? 1 : data.alpha;
    const visible = typeof data.visible === 'undefined' ? true : data.visible;
    const brush = new PIXI.Graphics();
    brush.beginFill(data.fill);
    // Draw the shape depending on type of brush
    switch (data.shape) {
      case this.BRUSH_TYPES.ELLIPSE:
        brush.drawEllipse(0, 0, data.width, data.height);
        break;
      case this.BRUSH_TYPES.BOX:
        brush.drawRect(0, 0, data.width, data.height);
        break;
      case this.BRUSH_TYPES.ROUNDED_RECT:
        brush.drawRoundedRect(0, 0, data.width, data.height, 10);
        break;
      case this.BRUSH_TYPES.POLYGON:
        brush.drawPolygon(data.vertices);
        break;
      default:
        break;
    }
    // End fill and set the basic props
    brush.endFill();
    brush.alpha = alpha;
    brush.visible = visible;
    brush.x = data.x;
    brush.y = data.y;
    brush.zIndex = data.zIndex;
    return brush;
  }

  /**
   * Gets a brush using the given parameters, renders it to mask and saves the event to history
   * @param data {Object}       A collection of brush parameters
   * @param save {Boolean}      If true, will add the operation to the history buffer
   */
  renderBrush(data, save = true) {
    const brush = this.brush(data);
    this.composite(brush);
    brush.destroy();
    if (save) this.historyBuffer.push(data);
  }

  /**
   * Renders the given brush to the layer mask
   * @param data {Object}       PIXI Object to be used as brush
   */
  composite(brush) {
    canvas.app.renderer.render(brush, this.maskTexture, false, null, false);
  }

  /**
   * Returns an empty PIXI Container of canvas dimensions
   */
  static getCanvasContainer() {
    const container = new PIXI.Container();
    const d = canvas.dimensions;
    container.width = d.width;
    container.height = d.height;
    container.x = 0;
    container.y = 0;
    container.zIndex = 0;
    return container;
  }

  _onClickLeft(e) {
    // Don't allow new action if history push still in progress
    // @ts-ignore
    //   // if (this.historyBuffer.length > 0) return;
    //   // On left mouse button
    //   if (e.data.button === 0) {
    const p = e.data.getLocalPosition(canvas.app.stage);
    // Round positions to nearest pixel
    p.x = Math.round(p.x);
    p.y = Math.round(p.y);
    //     // this.op = true;
    //     // Check active tool
    //     // @ts-ignore
    switch (game.activeTool) {
      case 'tile':
        // Validate that the drop position is in-bounds and snap to grid
        if (!canvas.grid.hitArea.contains(p.x, p.y)) return false;
        // Create the Tile
        //@ts-ignore
        this.constructor.placeableClass.create({});
        break;
      default:
        // Do nothing
        break;
    }
    //     // Call _pointermove so single click will still draw brush if mouse does not move
    //     // this._pointerMove(e);
    //   }
  }

  /**
   * Mouse handlers for canvas layer interactions
   */

  _pointerDown(e) {
    // Don't allow new action if history push still in progress
    if (this.historyBuffer.length > 0) return;
    // On left mouse button
    if (e.data.button === 0) {
      const p = e.data.getLocalPosition(canvas.app.stage);
      // Round positions to nearest pixel
      p.x = Math.round(p.x);
      p.y = Math.round(p.y);
      this.op = true;
      // Check active tool
      switch (this.activeTool) {
        case 'select':
          this._pointerDownSelect(p);
          break;
        case 'brush':
          this._pointerDownBrush();
          break;
        default:
          // Do nothing
          break;
      }
      // Call _pointermove so single click will still draw brush if mouse does not move
      this._pointerMove(e);
    }
    // On right button, cancel action
    else if (e.data.button === 2) {
      // Todo: Not sure why this doesnt trigger when drawing ellipse & box
      if (['polygon', 'box', 'ellipse'].includes(this.activeTool)) {
        this.clearActiveTool();
      }
    }
  }

  _pointerMove(e) {
    // Get mouse position translated to canvas coords
    const p = e.data.getLocalPosition(canvas.app.stage);
    // Round positions to nearest pixel
    p.x = Math.round(p.x);
    p.y = Math.round(p.y);
    switch (this.activeTool) {
      case 'select':
        this._pointerMoveSelect(p, e);
        break;
      case 'brush':
        this._pointerMoveBrush(p);
        break;
      default:
        break;
    }
  }

  _pointerUp(e) {
    // Only react to left mouse button
    if (e.data.button === 0) {
      // Translate click to canvas position
      const p = e.data.getLocalPosition(canvas.app.stage);
      // Round positions to nearest pixel
      p.x = Math.round(p.x);
      p.y = Math.round(p.y);
      // this._pointerUpX(p, e);
      switch (this.op) {
        case 'select':
          this._pointerUpSelect(p, e);
          break;
        case 'brush':
          this._pointerUpBrush(p);
          break;
        default:
          // Do nothing
          break;
      }
      // Reset operation
      this.op = false;
      // Push the history buffer
      this.commitHistory();
    }
  }

  /*
   * Select Tool
   */
  _pointerDownSelect(p) {
    // Set active drag operation
    this.op = 'select';
    // Set drag start coords
    this.dragStart.x = p.x;
    this.dragStart.y = p.y;
    // Reveal the preview shape
    this.boxPreview.visible = true;
    this.boxPreview.x = p.x;
    this.boxPreview.y = p.y;
  }

  _pointerMoveSelect(p, e) {
    // If drag operation has started
    if (this.op) {
      // update the preview shape
      const d = this._getDragBounds(p, e);
      this.boxPreview.width = d.w;
      this.boxPreview.height = d.h;
    }
  }

  _pointerUpSelect(p, e) {
    // update the preview shape
    // const d = this._getDragBounds(p, e);
    // this.renderBrush({
    //   shape: this.BRUSH_TYPES.BOX,
    //   x: this.dragStart.x,
    //   y: this.dragStart.y,
    //   width: d.w,
    //   height: d.h,
    //   fill: this.getUserSetting('brushOpacity'),
    // });
    // this.boxPreview.visible = false;
  }

  /**
   * Brush Tool
   */
  _pointerDownBrush() {
    this.op = true;
  }

  _pointerMoveBrush(p) {
    const size = 20; //this.getUserSetting('brushSize');

    // If drag operation has started
    if (this.op) {
      // Send brush movement events to renderbrush to be drawn and added to history stack
      this.renderBrush({
        shape: this.BRUSH_TYPES.ELLIPSE,
        x: p.x,
        y: p.y,
        fill: this.getUserSetting('brushOpacity'),
        width: this.getUserSetting('brushSize'),
        height: this.getUserSetting('brushSize'),
      });
    }
  }

  _pointerUpBrush(p) {
    //
  }

  /**
   * Aborts any active drawing tools
   */
  clearActiveTool() {
    // Box preview
    this.boxPreview.visible = false;
    // Cancel op flag
    this.op = false;
    // Clear history buffer
    this.historyBuffer = [];
  }

  /*
   * Returns height and width given a pointer coord and event for modifer keys
   */
  _getDragBounds(p, e) {
    let h = p.y - this.dragStart.y;
    let w = p.x - this.dragStart.x;
    if (e.data.originalEvent.shiftKey) {
      const ws = Math.sign(w);
      const hs = Math.sign(h);
      if (Math.abs(h) > Math.abs(w)) w = Math.abs(h) * ws;
      else h = Math.abs(w) * hs;
    }
    return { w, h };
  }
}
