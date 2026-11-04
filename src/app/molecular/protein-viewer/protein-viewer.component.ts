import { Component, Input, OnInit, OnDestroy, AfterViewInit, ViewChild, ElementRef, inject, effect, PLATFORM_ID, Inject, NgZone } from '@angular/core';
import { CommonModule, isPlatformBrowser } from '@angular/common';
import { Protein, Residue } from '../../core/models/protein.model';
import { ProteinViewerService } from '../../core/services/protein-viewer.service';
import { PredictionMethod } from '../../core/models/method.model';
import { ProteinRepresentation } from '../../core/models/protein-structure.model';

@Component({
  selector: 'app-protein-viewer',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './protein-viewer.component.html',
  styleUrl: './protein-viewer.component.scss'
})
export class ProteinViewerComponent implements OnInit, AfterViewInit, OnDestroy {
  @ViewChild('viewerContainer', { static: false }) viewerContainer!: ElementRef<HTMLDivElement>;
  
  @Input() protein: Protein | null = null;
  @Input() selectedResidue: Residue | null = null;
  @Input() method: PredictionMethod = 'AdaBind';

  private viewerService = inject(ProteinViewerService);
  private platformId = inject(PLATFORM_ID);
  private ngZone = inject(NgZone);
  private hasLoadedProtein = false;
  private fullscreenChangeHandler: (() => void) | null = null;

  // Viewer state
  viewerState = this.viewerService.viewerState;
  isLoading = this.viewerService.isLoading;
  error = this.viewerService.error;
  isInitialized = this.viewerService.isInitialized;

  // UI state
  showControls = true;
  isFullscreen = false;
  showResidueInfo = false;

  // Representation options
  representations: Array<{ value: ProteinRepresentation; label: string; icon: string }> = [
    { value: 'cartoon', label: 'Cartoon', icon: 'cartoon' },
    { value: 'surface', label: 'Surface', icon: 'surface' },
    { value: 'ball-stick', label: 'Ball & Stick', icon: 'ball-stick' },
    { value: 'backbone', label: 'Backbone', icon: 'backbone' }
  ];

  constructor() {
    // Watch for residue selection changes
    effect(() => {
      const residue = this.selectedResidue;
      if (residue && this.isInitialized()) {
        this.viewerService.selectResidue(
          residue.chainId || 'A',
          residue.position
        );
        this.showResidueInfo = true;
      }
    });

    // Listen for fullscreen changes (including ESC key)
    if (isPlatformBrowser(this.platformId)) {
      this.fullscreenChangeHandler = () => {
        // Run inside Angular zone to trigger change detection
        this.ngZone.run(() => {
          // Sync with actual browser fullscreen state (source of truth)
          this.isFullscreen = !!document.fullscreenElement;
          
          // Resize viewer after fullscreen change
          setTimeout(() => {
            this.viewerService.handleResize();
          }, 100);
        });
      };
      
      document.addEventListener('fullscreenchange', this.fullscreenChangeHandler);
    }
  }

  async ngOnInit(): Promise<void> {
    // Initialization will happen in AfterViewInit
  }

  async ngAfterViewInit(): Promise<void> {
    console.log('ProteinViewerComponent ngAfterViewInit, protein:', this.protein);
    if (this.viewerContainer) {
      try {
        console.log('Initializing viewer...');
        await this.viewerService.initialize(this.viewerContainer.nativeElement);
        console.log('Viewer initialized');
        
        // Force a resize to ensure proper canvas dimensions
        setTimeout(() => {
          this.viewerService.handleResize();
        }, 100);
        
        // Load protein if available
        if (this.protein) {
          console.log('Loading protein after init:', this.protein.id);
          await this.loadProtein();
          this.hasLoadedProtein = true;
        }
      } catch (error) {
        console.error('Failed to initialize viewer:', error);
      }
    }
  }

  async ngOnChanges(): Promise<void> {
    console.log('ProteinViewerComponent ngOnChanges, protein:', this.protein, 'isInitialized:', this.isInitialized());
    
    // Only reload if initialized and protein changed
    if (this.protein && this.isInitialized() && this.hasLoadedProtein) {
      console.log('Reloading protein due to change');
      await this.loadProtein();
    }
    
    // Update binding residues when method changes
    if (this.method && this.protein && this.isInitialized() && this.hasLoadedProtein) {
      console.log('Updating binding residues for method:', this.method);
      await this.viewerService.updateBindingResidues(this.protein.id, this.method);
    }
  }

  ngOnDestroy(): void {
    this.viewerService.dispose();
    
    // Remove fullscreen event listener
    if (isPlatformBrowser(this.platformId) && this.fullscreenChangeHandler) {
      document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler);
      this.fullscreenChangeHandler = null;
    }
  }

  private async loadProtein(): Promise<void> {
    if (!this.protein) return;

    console.log('loadProtein called for:', this.protein.id);
    try {
      await this.viewerService.loadProtein(this.protein.id, this.method);
      console.log('Protein loaded in component');
    } catch (error) {
      console.error('Failed to load protein:', error);
    }
  }

  // Control actions
  onResetCamera(): void {
    this.viewerService.resetCamera();
  }

  onZoomIn(): void {
    this.viewerService.zoomIn();
  }

  onZoomOut(): void {
    this.viewerService.zoomOut();
  }

  onSetRepresentation(representation: ProteinRepresentation): void {
    this.viewerService.setRepresentation(representation);
  }

  onToggleBindingSite(): void {
    this.viewerService.toggleBindingSite();
  }

  onTogglePredictions(): void {
    this.viewerService.togglePredictions();
  }

  onToggleSurface(): void {
    const current = this.viewerState();
    this.viewerService.toggleSurface(!current.showBindingSite);
  }

  onToggleLabels(): void {
    this.viewerService.toggleLabels();
  }

  onToggleLigands(): void {
    this.viewerService.toggleLigands();
  }

  onToggleMetals(): void {
    this.viewerService.toggleMetals();
  }

  onFocusBindingPocket(): void {
    this.viewerService.focusBindingPocket();
  }

  async onToggleFullscreen(): Promise<void> {
    if (!isPlatformBrowser(this.platformId)) return;

    try {
      // Check current fullscreen state from document (source of truth)
      const isCurrentlyFullscreen = !!document.fullscreenElement;
      
      if (isCurrentlyFullscreen) {
        await document.exitFullscreen();
      } else {
        const fullscreenElement = this.viewerContainer.nativeElement.parentElement;
        if (fullscreenElement) {
          await fullscreenElement.requestFullscreen();
        }
      }
    } catch (error) {
      console.error('Fullscreen toggle failed:', error);
      // Sync state with actual fullscreen state in case of error
      this.isFullscreen = !!document.fullscreenElement;
    }
  }

  onCloseResidueInfo(): void {
    this.showResidueInfo = false;
    this.viewerService.clearSelection();
  }

  onRetry(): void {
    if (this.protein) {
      this.loadProtein();
    }
  }

  // Utility
  formatConfidence(value: number): string {
    return (value * 100).toFixed(1) + '%';
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'TP': return '#10B981';
      case 'TN': return '#64748B';
      case 'FP': return '#F97316';
      case 'FN': return '#EF4444';
      default: return '#94A3B8';
    }
  }

  getStatusLabel(status: string): string {
    switch (status) {
      case 'TP': return 'True Positive';
      case 'FP': return 'False Positive';
      case 'FN': return 'False Negative';
      case 'TN': return 'True Negative';
      default: return 'Unknown';
    }
  }
}
