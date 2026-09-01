import { Component, OnInit, AfterViewInit, ElementRef, ViewChild, signal, computed, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MockDataService } from '../../../core/services/mock-data.service';
import { Protein } from '../../../core/models/protein.model';
import { PredictionMethod } from '../../../core/models/method.model';
import { DataTableComponent, DataTableColumn } from '../../../shared/ui/data-table/data-table.component';
import * as echarts from 'echarts';

type EChartsOption = echarts.EChartsOption;

interface ProteinTableRow {
  id: string;
  name: string;
  length: number;
  bindingResidues: number;
  esmOrionF1: number;
  esmOrionMCC: number;
  bindingType: string;
}

@Component({
  selector: 'app-benchmark-testset46',
  standalone: true,
  imports: [CommonModule, FormsModule, DataTableComponent],
  templateUrl: './benchmark-testset46.component.html',
  styleUrl: './benchmark-testset46.component.scss'
})
export class BenchmarkTestset46Component implements OnInit, AfterViewInit {
  @ViewChild('bindingTypeChart') bindingTypeChart!: ElementRef;
  @ViewChild('lengthDistChart') lengthDistChart!: ElementRef;
  @ViewChild('f1DistChart') f1DistChart!: ElementRef;
  @ViewChild('mccDistChart') mccDistChart!: ElementRef;

  private route = inject(ActivatedRoute);
  private mockDataService = inject(MockDataService);

  // State
  proteins = signal<Protein[]>([]);
  filteredProteins = computed(() => this.applyFilters());
  
  // Filters
  searchQuery = signal('');
  selectedBindingType = signal<string>('all');
  selectedMethod = signal<PredictionMethod>('ESM-ORION');
  lengthRange = signal<string>('all');

  // Table columns
  columns: DataTableColumn<ProteinTableRow>[] = [
    {
      key: 'name',
      label: 'Protein',
      sortable: true,
      width: '200px',
      render: (row) => `<span class="protein-id">${row.name}</span>`
    },
    {
      key: 'length',
      label: 'Length',
      sortable: true,
      width: '100px',
      align: 'right',
      render: (row) => `<span class="mono-value">${row.length}</span>`
    },
    {
      key: 'bindingResidues',
      label: 'Binding Residues',
      sortable: true,
      width: '140px',
      align: 'right',
      render: (row) => `<span class="mono-value">${row.bindingResidues}</span>`
    },
    {
      key: 'esmOrionF1',
      label: 'ESM-ORION F1',
      sortable: true,
      width: '140px',
      align: 'right',
      render: (row) => `<span class="metric-value">${row.esmOrionF1.toFixed(3)}</span>`
    },
    {
      key: 'esmOrionMCC',
      label: 'ESM-ORION MCC',
      sortable: true,
      width: '140px',
      align: 'right',
      render: (row) => `<span class="metric-value">${row.esmOrionMCC.toFixed(3)}</span>`
    },
    {
      key: 'bindingType',
      label: 'Type',
      sortable: true,
      width: '120px',
      render: (row) => `<span class="type-badge">${row.bindingType}</span>`
    }
  ];

  // Options
  bindingTypeOptions = [
    { value: 'all', label: 'All Types' },
    { value: 'metal', label: 'Metal' },
    { value: 'nucleic-acid', label: 'Nucleic Acid' },
    { value: 'small-molecule', label: 'Small Molecule' },
    { value: 'other', label: 'Other' }
  ];

  lengthOptions = [
    { value: 'all', label: 'All Lengths' },
    { value: '0-200', label: '0-200 aa' },
    { value: '201-400', label: '201-400 aa' },
    { value: '401-600', label: '401-600 aa' },
    { value: '601+', label: '601+ aa' }
  ];

  // Stats (different from TestSet300)
  stats = computed(() => {
    const proteins = this.filteredProteins();
    return {
      total: proteins.length,
      avgLength: Math.round(proteins.reduce((sum, p) => sum + p.length, 0) / proteins.length),
      totalBindingResidues: proteins.reduce((sum, p) => sum + (p.length * 0.09), 0),
      avgF1: 0.823
    };
  });

  ngOnInit(): void {
    this.mockDataService.getProteinsByDataset('testset46').subscribe(proteins => {
      this.proteins.set(proteins);
    });
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      this.initCharts();
    }, 100);
  }

  applyFilters(): ProteinTableRow[] {
    let filtered = this.proteins();

    // Search filter
    const query = this.searchQuery().toLowerCase();
    if (query) {
      filtered = filtered.filter(p => 
        p.id.toLowerCase().includes(query) ||
        p.name.toLowerCase().includes(query) ||
        p.pdbId.toLowerCase().includes(query)
      );
    }

    // Binding type filter
    const bindingType = this.selectedBindingType();
    if (bindingType !== 'all') {
      filtered = filtered.filter((_, index) => index % 3 === 0);
    }

    // Length filter
    const lengthRange = this.lengthRange();
    if (lengthRange !== 'all') {
      filtered = filtered.filter(p => {
        const len = p.length;
        if (lengthRange === '0-200') return len <= 200;
        if (lengthRange === '201-400') return len > 200 && len <= 400;
        if (lengthRange === '401-600') return len > 400 && len <= 600;
        if (lengthRange === '601+') return len > 600;
        return true;
      });
    }

    return filtered.map(p => ({
      id: p.id,
      name: p.name,
      length: p.length,
      bindingResidues: Math.round(p.length * 0.09),
      esmOrionF1: 0.72 + Math.random() * 0.22,
      esmOrionMCC: 0.68 + Math.random() * 0.22,
      bindingType: ['Metal', 'Nucleic Acid', 'Small Molecule'][Math.floor(Math.random() * 3)]
    }));
  }

  resetFilters(): void {
    this.searchQuery.set('');
    this.selectedBindingType.set('all');
    this.lengthRange.set('all');
  }

  initCharts(): void {
    this.initBindingTypeChart();
    this.initLengthDistChart();
    this.initF1DistChart();
    this.initMCCDistChart();
  }

  initBindingTypeChart(): void {
    if (!this.bindingTypeChart) return;

    const chart = echarts.init(this.bindingTypeChart.nativeElement);
    const option: EChartsOption = {
      tooltip: {
        trigger: 'item',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' }
      },
      series: [{
        type: 'pie',
        radius: ['40%', '70%'],
        avoidLabelOverlap: false,
        itemStyle: {
          borderRadius: 8,
          borderColor: '#0B1020',
          borderWidth: 2
        },
        label: {
          show: true,
          position: 'outside',
          color: '#F8FAFC',
          formatter: '{b}: {c}'
        },
        data: [
          { value: 18, name: 'Metal', itemStyle: { color: '#22D3EE' } },
          { value: 16, name: 'Nucleic Acid', itemStyle: { color: '#10B981' } },
          { value: 10, name: 'Small Molecule', itemStyle: { color: '#38BDF8' } },
          { value: 2, name: 'Other', itemStyle: { color: '#64748B' } }
        ]
      }]
    };
    chart.setOption(option);

    window.addEventListener('resize', () => chart.resize());
  }

  initLengthDistChart(): void {
    if (!this.lengthDistChart) return;

    const chart = echarts.init(this.lengthDistChart.nativeElement);
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' }
      },
      xAxis: {
        type: 'category',
        data: ['0-100', '101-200', '201-300', '301-400', '401-500', '501-600', '601+'],
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        data: [3, 8, 12, 10, 8, 4, 1],
        type: 'bar',
        itemStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: '#10B981' },
            { offset: 1, color: '#059669' }
          ]),
          borderRadius: [4, 4, 0, 0]
        }
      }]
    };
    chart.setOption(option);

    window.addEventListener('resize', () => chart.resize());
  }

  initF1DistChart(): void {
    if (!this.f1DistChart) return;

    const chart = echarts.init(this.f1DistChart.nativeElement);
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' }
      },
      xAxis: {
        type: 'category',
        data: ['0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9', '0.9-1.0'],
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        data: [2, 5, 14, 18, 7],
        type: 'line',
        smooth: true,
        lineStyle: { color: '#22D3EE', width: 3 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(34, 211, 238, 0.3)' },
            { offset: 1, color: 'rgba(34, 211, 238, 0.05)' }
          ])
        },
        itemStyle: { color: '#22D3EE' }
      }]
    };
    chart.setOption(option);

    window.addEventListener('resize', () => chart.resize());
  }

  initMCCDistChart(): void {
    if (!this.mccDistChart) return;

    const chart = echarts.init(this.mccDistChart.nativeElement);
    const option: EChartsOption = {
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#1E293B',
        borderColor: '#38BDF8',
        textStyle: { color: '#F8FAFC' }
      },
      xAxis: {
        type: 'category',
        data: ['0.4-0.5', '0.5-0.6', '0.6-0.7', '0.7-0.8', '0.8-0.9'],
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#94A3B8' },
        axisLine: { lineStyle: { color: '#334155' } },
        splitLine: { lineStyle: { color: '#1E293B' } }
      },
      series: [{
        data: [3, 7, 16, 15, 5],
        type: 'line',
        smooth: true,
        lineStyle: { color: '#F97316', width: 3 },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(249, 115, 22, 0.3)' },
            { offset: 1, color: 'rgba(249, 115, 22, 0.05)' }
          ])
        },
        itemStyle: { color: '#F97316' }
      }]
    };
    chart.setOption(option);

    window.addEventListener('resize', () => chart.resize());
  }
}
