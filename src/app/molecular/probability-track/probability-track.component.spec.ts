import { TestBed } from '@angular/core/testing';
import { ProbabilityTrackComponent } from './probability-track.component';

describe('ProbabilityTrackComponent', () => {
  function render(length: number, bindingAt: number[]) {
    const fixture = TestBed.createComponent(ProbabilityTrackComponent);
    const track = fixture.componentInstance;
    track.sequence = 'ACDEFGHIKLMNPQRSTVWY'.repeat(10).slice(0, length);
    track.probability = Array.from({ length }, (_, i) => (bindingAt.includes(i + 1) ? 0.95 : 0.1));
    track.binding = Array.from({ length }, (_, i) => bindingAt.includes(i + 1));
    track.plddt = Array.from({ length }, () => 0.9);
    track.ngOnChanges();
    fixture.detectChanges();
    return { fixture, track, el: fixture.nativeElement as HTMLElement };
  }

  it('wraps the sequence into rows of 50 numbered from their first residue', () => {
    const { el } = render(120, []);
    expect(el.querySelectorAll('.cell').length).toBe(120);
    expect([...el.querySelectorAll('.row-start')].map(e => e.textContent?.trim())).toEqual(['1', '51', '101']);
  });

  it('outlines binding residues and describes each residue', () => {
    const { el } = render(60, [3, 55]);
    const binding = el.querySelectorAll('.cell.binding');
    expect(binding.length).toBe(2);
    expect(binding[0].getAttribute('title')).toBe('D3 · p = 0.950 · BINDING · pLDDT 0.90');
  });

  it('emits the 1-based index of a clicked residue', () => {
    const { el, track } = render(60, []);
    const clicked: number[] = [];
    track.residueSelect.subscribe(i => clicked.push(i));
    (el.querySelectorAll('.cell')[51] as HTMLButtonElement).click();
    expect(clicked).toEqual([52]);
  });
});
