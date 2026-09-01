import { Pipe, PipeTransform } from '@angular/core';

@Pipe({
  name: 'percentage',
  standalone: true
})
export class PercentagePipe implements PipeTransform {
  transform(value: number, decimals: number = 1): string {
    if (value === null || value === undefined) return '-';
    return `${(value * 100).toFixed(decimals)}%`;
  }
}
