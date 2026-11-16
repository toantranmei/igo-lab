import { NextRequest, NextResponse } from 'next/server';
import { handle } from '@/lib/server/router';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Ctx = { params: Promise<{ path: string[] }> };
const run = async (req: NextRequest, ctx: Ctx) => handle(req, (await ctx.params).path) as Promise<NextResponse>;
export const GET = run;
export const POST = run;
export const PUT = run;
export const DELETE = run;
