import * as NGL from 'ngl';
import { MolecularViewerAdapter } from './molecular-viewer.adapter';
import { ProteinStructure, ProteinRepresentation, BindingResidue } from '../models/protein-structure.model';

export class NGLViewerAdapter implements MolecularViewerAdapter {
  private stage: NGL.Stage | null = null;
  private structureComponent: NGL.StructureComponent | null = null;
  private bindingResidues: BindingResidue[] = [];
  private currentRepresentation: ProteinRepresentation = 'cartoon';
  private showBindingSite = false;
  private showPredictions = false;
  private showLabels = false;
  private showLigands = false;
  private showMetals = false;
  private selectedResidueSelection: NGL.Selection | null = null;

  async initialize(container: HTMLElement): Promise<void> {
    // Get background color from CSS variable
    const bgColor = this.getBackgroundColorFromCSS();
    
    this.stage = new NGL.Stage(container, {
      backgroundColor: bgColor,
      quality: 'high',
      sampleLevel: 2,
      clipNear: 0,
      clipFar: 100,
      clipDist: 10,
      fogNear: 50,
      fogFar: 100
    });

    this.stage.setParameters({ 
      lightIntensity: 1.0,
      ambientIntensity: 0.3
    });

    // Handle window resize
    window.addEventListener('resize', () => {
      this.stage?.handleResize();
    });

    // Listen for theme changes
    this.observeThemeChanges();

    // Initial resize to ensure proper canvas dimensions
    setTimeout(() => {
      this.stage?.handleResize();
    }, 0);
  }

  private getBackgroundColorFromCSS(): string {
    // Get the computed background color from CSS variable
    const computedColor = getComputedStyle(document.documentElement)
      .getPropertyValue('--color-bg-primary')
      .trim();
    
    // Return the color or fallback to dark theme color
    return computedColor || '#0B1020';
  }

  private observeThemeChanges(): void {
    // Observe theme attribute changes on document element
    const observer = new MutationObserver(() => {
      const bgColor = this.getBackgroundColorFromCSS();
      this.setBackgroundColor(bgColor);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'class']
    });
  }

  async loadStructure(structure: ProteinStructure): Promise<void> {
    if (!structure.pdbData) {
      throw new Error('No PDB data provided');
    }
    
    this.bindingResidues = structure.bindingResidues || [];
    await this.loadPDB(structure.pdbData);
  }

  async loadPDB(pdbData: string): Promise<void> {
    if (!this.stage) {
      throw new Error('Stage not initialized');
    }

    console.log('Loading PDB data, length:', pdbData.length);
    this.clear();

    try {
      // Load structure from PDB string
      const blob = new Blob([pdbData], { type: 'text/plain' });
      console.log('Loading blob into NGL stage...');
      const component = await this.stage.loadFile(blob, { ext: 'pdb' });
      
      console.log('Component loaded:', component);
      this.structureComponent = component as NGL.StructureComponent;

      // Add default cartoon representation
      console.log('Adding cartoon representation...');
      this.structureComponent.addRepresentation('cartoon', {
        color: 'chainname',
        quality: 'high',
        smoothSheet: true
      });

      // Center and zoom
      console.log('Auto-viewing structure...');
      this.stage.autoView();
      
      console.log('PDB loaded successfully');
    } catch (error) {
      console.error('Failed to load PDB structure:', error);
      throw error;
    }
  }

  clear(): void {
    if (this.stage) {
      this.stage.removeAllComponents();
      this.structureComponent = null;
      this.selectedResidueSelection = null;
    }
  }

  resetCamera(): void {
    this.stage?.autoView(1000);
  }

  zoomIn(): void {
    if (!this.stage?.viewerControls) return;
    
    // Get current distance
    const controls = this.stage.viewerControls as any;
    const currentDistance = controls.viewer.camera.position.z;
    
    // Zoom in by moving camera closer (multiply by 0.8)
    const newDistance = currentDistance * 0.8;
    controls.viewer.camera.position.z = newDistance;
    
    // Render the scene
    this.stage.viewer.requestRender();
  }

  zoomOut(): void {
    if (!this.stage?.viewerControls) return;
    
    // Get current distance
    const controls = this.stage.viewerControls as any;
    const currentDistance = controls.viewer.camera.position.z;
    
    // Zoom out by moving camera farther (multiply by 1.2)
    const newDistance = currentDistance * 1.2;
    controls.viewer.camera.position.z = newDistance;
    
    // Render the scene
    this.stage.viewer.requestRender();
  }

  centerOnResidue(chainId: string, residueNumber: number): void {
    if (!this.structureComponent) return;

    this.stage?.autoView();
  }

  selectResidue(chainId: string, residueNumber: number): void {
    if (!this.structureComponent) return;

    // Clear previous selection
    this.clearSelection();

    // Add selection representation
    this.structureComponent.addRepresentation('ball+stick', {
      sele: `${residueNumber}:${chainId}`,
      color: '#F59E0B',
      scale: 2.0,
      aspectRatio: 1.5
    });

    // Center camera
    this.centerOnResidue(chainId, residueNumber);
  }

  clearSelection(): void {
    if (!this.structureComponent) return;

    // Remove selection representations
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().color === '#F59E0B') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });
  }

  highlightResidues(residues: BindingResidue[]): void {
    if (!this.structureComponent) return;

    this.bindingResidues = residues;

    // Remove old highlights
    this.structureComponent.reprList.forEach((repr: any) => {
      const params = repr.getParameters();
      if (params.name === 'binding-highlight' || params.name === 'prediction-highlight') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (this.showBindingSite) {
      this.toggleBindingSite(true);
    }

    if (this.showPredictions) {
      this.togglePredictions(true);
    }
  }

  setRepresentation(representation: ProteinRepresentation): void {
    if (!this.structureComponent) return;

    this.currentRepresentation = representation;

    // Remove all non-highlight representations
    this.structureComponent.reprList.forEach((repr: any) => {
      const params = repr.getParameters();
      if (!params.name || (!params.name.includes('highlight') && !params.name.includes('selection'))) {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    // Add new representation
    switch (representation) {
      case 'cartoon':
        this.structureComponent.addRepresentation('cartoon', {
          color: 'chainname',
          quality: 'high',
          smoothSheet: true
        });
        break;
      case 'surface':
        this.structureComponent.addRepresentation('surface', {
          color: 'chainname',
          surfaceType: 'ms',
          opacity: 0.8,
          quality: 'high'
        });
        break;
      case 'ball-stick':
        this.structureComponent.addRepresentation('ball+stick', {
          color: 'element',
          scale: 1.0
        });
        break;
      case 'backbone':
        this.structureComponent.addRepresentation('backbone', {
          color: 'chainname'
        });
        break;
      case 'ribbon':
        this.structureComponent.addRepresentation('ribbon', {
          color: 'chainname'
        });
        break;
    }
  }

  toggleSurface(visible: boolean): void {
    if (!this.structureComponent) return;

    if (visible) {
      this.structureComponent.addRepresentation('surface', {
        color: 'chainname',
        surfaceType: 'ms',
        opacity: 0.3,
        name: 'surface-overlay'
      });
    } else {
      this.structureComponent.reprList.forEach((repr: any) => {
        if (repr.getParameters().name === 'surface-overlay') {
          this.structureComponent?.removeRepresentation(repr);
        }
      });
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  toggleBindingSite(visible: boolean): void {
    if (!this.structureComponent) return;

    this.showBindingSite = visible;

    // Remove existing binding site representation
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().name === 'binding-highlight') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (visible && this.bindingResidues.length > 0) {
      // Get ground truth binding residues
      const groundTruthResidues = this.bindingResidues.filter(r => r.groundTruth);
      
      if (groundTruthResidues.length > 0) {
        const selection = groundTruthResidues
          .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
          .join(' or ');

        this.structureComponent.addRepresentation('ball+stick', {
          sele: selection,
          color: '#22D3EE',
          scale: 1.5,
          name: 'binding-highlight'
        });
      }
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  togglePredictions(visible: boolean): void {
    if (!this.structureComponent) return;

    this.showPredictions = visible;

    // Remove existing prediction representation
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().name === 'prediction-highlight') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (visible && this.bindingResidues.length > 0) {
      // True Positives (TP) - green
      const tpResidues = this.bindingResidues.filter(r => r.status === 'TP');
      if (tpResidues.length > 0) {
        const selection = tpResidues
          .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
          .join(' or ');
        
        this.structureComponent.addRepresentation('spacefill', {
          sele: selection,
          color: '#10B981',
          scale: 0.5,
          name: 'prediction-highlight'
        });
      }

      // False Positives (FP) - orange
      const fpResidues = this.bindingResidues.filter(r => r.status === 'FP');
      if (fpResidues.length > 0) {
        const selection = fpResidues
          .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
          .join(' or ');
        
        this.structureComponent.addRepresentation('spacefill', {
          sele: selection,
          color: '#F97316',
          scale: 0.5,
          name: 'prediction-highlight'
        });
      }

      // False Negatives (FN) - red
      const fnResidues = this.bindingResidues.filter(r => r.status === 'FN');
      if (fnResidues.length > 0) {
        const selection = fnResidues
          .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
          .join(' or ');
        
        this.structureComponent.addRepresentation('spacefill', {
          sele: selection,
          color: '#EF4444',
          scale: 0.5,
          name: 'prediction-highlight'
        });
      }
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  toggleLabels(visible: boolean): void {
    if (!this.structureComponent) return;

    this.showLabels = visible;

    // Remove existing label representation
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().name === 'residue-labels') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (visible && this.bindingResidues.length > 0) {
      const selection = this.bindingResidues
        .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
        .join(' or ');

      this.structureComponent.addRepresentation('label', {
        sele: selection,
        color: '#F8FAFC',
        labelType: 'residue',
        name: 'residue-labels'
      });
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  toggleLigands(visible: boolean): void {
    if (!this.structureComponent) return;

    this.showLigands = visible;

    // Remove existing ligand representation
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().name === 'ligands') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (visible) {
      this.structureComponent.addRepresentation('ball+stick', {
        sele: 'hetero and not water',
        color: 'element',
        scale: 1.2,
        name: 'ligands'
      });
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  toggleMetals(visible: boolean): void {
    if (!this.structureComponent) return;

    this.showMetals = visible;

    // Remove existing metal representation
    this.structureComponent.reprList.forEach((repr: any) => {
      if (repr.getParameters().name === 'metals') {
        this.structureComponent?.removeRepresentation(repr);
      }
    });

    if (visible) {
      this.structureComponent.addRepresentation('spacefill', {
        sele: 'ion',
        color: 'element',
        scale: 1.5,
        name: 'metals'
      });
    }
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  focusBindingPocket(residues: BindingResidue[]): void {
    if (!this.structureComponent || residues.length === 0) return;

    // Create selection string for binding residues
    const selection = residues
      .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
      .join(' or ');

    // Focus camera on binding pocket residues with animation
    this.structureComponent.autoView(selection, 1000);
    
    // Trigger render update
    this.stage?.viewer.requestRender();
  }

  colorByConfidence(residues: BindingResidue[]): void {
    if (!this.structureComponent) return;

    // Group residues by confidence range
    const highConf = residues.filter(r => r.confidence >= 0.8);
    const medConf = residues.filter(r => r.confidence >= 0.6 && r.confidence < 0.8);
    const lowConf = residues.filter(r => r.confidence < 0.6);

    [
      { residues: highConf, color: '#10B981' },
      { residues: medConf, color: '#F59E0B' },
      { residues: lowConf, color: '#EF4444' }
    ].forEach(({ residues: resGroup, color }) => {
      if (resGroup.length > 0) {
        const selection = resGroup
          .map(r => `${r.residueNumber || r.position}:${r.chainId}`)
          .join(' or ');

        this.structureComponent?.addRepresentation('spacefill', {
          sele: selection,
          color,
          scale: 0.6,
          name: 'confidence-coloring'
        });
      }
    });
  }

  handleResize(): void {
    this.stage?.handleResize();
    console.log('NGL stage resized');
  }

  setBackgroundColor(color: string): void {
    this.stage?.setParameters({ backgroundColor: color });
  }

  getCameraState(): any {
    return this.stage?.viewerControls.getOrientation();
  }

  setCameraState(state: any): void {
    if (state && this.stage) {
      this.stage.viewerControls.orient(state);
    }
  }

  dispose(): void {
    if (this.stage) {
      this.stage.dispose();
      this.stage = null;
      this.structureComponent = null;
    }
  }
}
