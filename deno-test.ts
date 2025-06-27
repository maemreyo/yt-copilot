// A simple Deno test file
console.log("Deno is working!");

// Test import from std library
import { serve } from "std/http/server.ts";

// Test import from project using import map
import { corsHeaders } from "@/cors";

console.log("Imports are working!");
console.log("CORS Headers:", corsHeaders);