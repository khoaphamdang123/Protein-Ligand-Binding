import { Directive, ElementRef, HostListener, Input } from '@angular/core';

@Directive({
  selector: '[appHoverClass]',
  standalone: true
})
export class HoverClassDirective {
  @Input('appHoverClass') hoverClass: string = '';

  constructor(private el: ElementRef) {}

  @HostListener('mouseenter')
  onMouseEnter(): void {
    if (this.hoverClass) {
      this.el.nativeElement.classList.add(this.hoverClass);
    }
  }

  @HostListener('mouseleave')
  onMouseLeave(): void {
    if (this.hoverClass) {
      this.el.nativeElement.classList.remove(this.hoverClass);
    }
  }
}
