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
        path: 'benchmark/testsetnew46',
        loadComponent: () => import('./features/benchmark/benchmark-testset46/benchmark-testset46.component').then(m => m.BenchmarkTestset46Component),
        title: 'BindSite Explorer - TestSetNew46'
      },
      {
        path: 'benchmark/curves',
        loadComponent: () => import('./features/benchmark/benchmark-curves/benchmark-curves.component').then(m => m.BenchmarkCurvesComponent),
        title: 'BindSite Explorer - ROC & PR Curves'
      },
      {
        path: 'predict',
        loadComponent: () => import('./features/predict/predict.component').then(m => m.PredictComponent),
        title: 'BindSite Explorer - Predict'
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
