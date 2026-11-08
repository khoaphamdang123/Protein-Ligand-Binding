import { ApplicationConfig, ErrorHandler, inject, provideAppInitializer, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withHashLocation } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideEchartsCore } from 'ngx-echarts';
import * as echarts from 'echarts/core';
import { BarChart, LineChart, RadarChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { AppConfigService } from './core/services/app-config.service';
import { ErrorReporterService, GlobalErrorHandler } from './core/services/error-reporter.service';

echarts.use([BarChart, LineChart, RadarChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    // Routes after "#" (/#/explore?dataset=...): any static host serves them, a reload or a shared link included,
    // because the server only ever sees index.html. index.html has <base href="./"> so a sub-path works as well.
    provideRouter(routes, withHashLocation()),
    // config.json next to index.html: where the AI server is, or that there is none (static hosting).
    provideAppInitializer(() => inject(AppConfigService).load()),
    provideHttpClient(),
    provideAnimations(),
    provideEchartsCore({ echarts }),
    // Every uncaught UI error is shown in the console and sent to the backend log.
    { provide: ErrorHandler, useClass: GlobalErrorHandler },
    provideAppInitializer(() => inject(ErrorReporterService).installWindowListeners()),
  ]
};
