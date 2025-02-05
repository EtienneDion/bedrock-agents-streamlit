import { NextRequest, NextResponse } from "next/server";
import { lambdaHandler } from '@/lib/lambdaHandler';

export async function POST(req: NextRequest) {
    try {
      const body = await req.json(); // Get JSON payload from request
      const response = await lambdaHandler(body, {}); // Call your function
      return NextResponse.json(JSON.parse(response.body), { status: response.statusCode });
    } catch (error) {
      return NextResponse.json({ error: (error as Error).message }, { status: 500 });
    }
  }