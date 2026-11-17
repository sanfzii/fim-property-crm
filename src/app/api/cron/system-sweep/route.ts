// Lokasi: src/app/api/cron/system-sweep/route.ts
// Layer 3: Route Handler untuk Vercel Daily Cron Job (Dilindungi CRON_SECRET)

import { NextResponse, type NextRequest } from 'next/server';
import { getServerEnv } from '@/lib/env/server';
import { serverLogger } from '@/lib/logger/server-logger';
import { ReminderSweepOrchestrator } from '@/modules/notifications-engine/reminder-sweep.orchestrator';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    // 1. Tolak cepat permintaan tanpa header Bearer sebelum mengakses konfigurasi / DB
    const authHeader = request.headers.get('authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED_CRON_CALL' },
        { status: 401 }
      );
    }

    // 2. Verifikasi ganda CRON_SECRET di tingkat Route Handler (Defense-in-Depth)
    const env = getServerEnv();
    if (authHeader !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json(
        { success: false, error: 'UNAUTHORIZED_CRON_CALL' },
        { status: 401 }
      );
    }

    const summary = await ReminderSweepOrchestrator.runFullSystemSweep();

    serverLogger.info('Daily cron system sweep completed successfully', {
      module: 'CronSystemSweep',
      action: 'GET',
      metadata: summary as unknown as Record<string, unknown>,
    });

    return NextResponse.json({
      success: true,
      data: summary,
    });
  } catch (error) {
    serverLogger.error('Daily cron system sweep failed', error, {
      module: 'CronSystemSweep',
      action: 'GET',
    });

    return NextResponse.json(
      {
        success: false,
        error: 'CRON_EXECUTION_FAILED',
      },
      { status: 500 }
    );
  }
}
