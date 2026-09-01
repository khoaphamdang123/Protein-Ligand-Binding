import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./layout/app-shell/app-shell.component').then(m => m.AppShellComponent),
    children: [
      {
        path: '',
        loadComponent: () => import('./features/home/home.component').then(m => m.HomeComponent),
        title: 'BindSite Explorer - Home'
      },
      {
        path: 'explore',
        loadComponent: () => import('./features/explorer/explorer.component').then(m => m.ExplorerComponent),
        title: 'BindSite Explorer - Explore'
      },
      {
        path: 'protein/:id',
        loadComponent: () => import('./features/protein/protein-detail/protein-detail.component').then(m => m.ProteinDetailComponent),
        title: 'BindSite Explorer - Protein Detail'
      },
      {
        path: 'benchmark',
        loadComponent: () => import('./features/benchmark/benchmark-list/benchmark-list.component').then(m => m.BenchmarkListComponent),
        title: 'BindSite Explorer - Benchmark'
      },
      {
        path: 'benchmark/testset300',
        loadComponent: () => import('./features/benchmark/benchmark-testset300/benchmark-testset300.component').then(m => m.BenchmarkTestset300Component),
        title: 'BindSite Explorer - TestSet300'
      },
      {
        path: 'benchmark/testset46',
        loadComponent: () => import('./features/benchmark/benchmark-testset46/benchmark-testset46.component').then(m => m.BenchmarkTestset46Component),
        title: 'BindSite Explorer - TestSet46'
      },
      {
        path: 'compare',
        loadComponent: () => import('./features/comparison/comparison.component').then(m => m.ComparisonComponent),
        title: 'BindSite Explorer - Compare'
      },
      {
        path: 'methods',
        loadComponent: () => import('./features/methods/methods.component').then(m => m.MethodsComponent),
        title: 'BindSite Explorer - Methods'
      },
      {
        path: 'about',
        loadComponent: () => import('./features/about/about.component').then(m => m.AboutComponent),
        title: 'BindSite Explorer - About'
      }
    ]
  },
  {
    path: '**',
    redirectTo: ''
  }
];
