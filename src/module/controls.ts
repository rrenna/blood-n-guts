import { MODULE_TITLE } from '../constants';
import BloodConfig from '../classes/BloodConfig';

/**
 * Add control buttons
 */
Hooks.on('getSceneControlButtons', (controls) => {
  if (game.user.isGM) {
    controls.push({
      name: 'blood',
      title: MODULE_TITLE,
      icon: 'fas fa-tint',
      layer: 'BloodLayer',
      tools: [
        {
          name: 'toggle',
          title: 'Toggle ' + MODULE_TITLE + ' on/off',
          icon: 'fas fa-eye',
          onClick: () => {
            canvas.blood.toggle();
          },
          active: true, //canvas.blood.visible, //todo: why is canvas available here in SimpleFog?
          toggle: true,
        },
        {
          name: 'select',
          title: 'Select blood splats',
          icon: 'fas fa-expand',
        },
        {
          name: 'brush',
          title: 'Draw blood splats to the scene',
          icon: 'fas fa-paint-brush',
        },
        {
          name: 'sceneConfig',
          title: "Configure Blood 'n Guts",
          icon: 'fas fa-cog',
          onClick: () => {
            // @ts-expect-error defintions wrong
            new BloodConfig().render(true);
          },
          button: true,
        },
        {
          name: 'wipe',
          title: 'Wipe all blood splats from this scene',
          icon: 'fas fa-trash',
          onClick: () => {
            const dg = new Dialog({
              title: 'Wipe Blood Layer',
              content: 'Are you sure? All blood splats will be deleted.',
              buttons: {
                blank: {
                  icon: '<i class="fas fa-trash"></i>',
                  label: 'Wipe',
                  callback: () => canvas.blood.resetLayer(true),
                },
                cancel: {
                  icon: '<i class="fas fa-times"></i>',
                  label: 'Cancel',
                },
              },
              default: 'reset',
            });
            dg.render(true);
          },
          button: true,
        },
      ],
      activeTool: 'brush',
    });
  }
});

/**
 * Handles adding the custom brush controls pallet
 * and switching active brush flag
 */
Hooks.on('renderSceneControls', (controls) => {
  // Switching to layer
  if (controls.activeControl === 'blood') {
    // Open brush tools if not already open
    if (!$('#blood-brush-controls').length) {
      canvas.blood.createBrushControls();
    }
    // Set active tool
    //const tool = controls.controls.find((control) => control.name === 'blood').activeTool;
    // canvas.blood.setActiveTool(tool);
  }
  // Switching away from layer
  else {
    // Clear active tool
    // canvas.blood.clearActiveTool();
    // Remove brush tools if open
    const bc = $('#blood-brush-controls');
    if (bc) bc.remove();
  }
});

/**
 * Sets Y position of the brush controls to account for scene navigation buttons
 */
function setBrushControlPos() {
  const bc = $('#blood-brush-controls');
  if (bc) {
    const h = $('#navigation').height();
    bc.css({ top: `${h + 30}px` });
  }
}

// Reset position when brush controls are rendered or sceneNavigation changes
Hooks.on('renderBrushControls', setBrushControlPos);
Hooks.on('renderSceneNavigation', setBrushControlPos);
