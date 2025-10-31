@echo off
REM Complete Data Update Pipeline for Windows
REM This script runs the full data update workflow

echo =========================================
echo Palestine Pulse - Data Update Pipeline
echo =========================================
echo.

REM Step 1: Fetch all data
echo Step 1: Fetching data from all sources...
echo -------------------------------------------
call npm run fetch-all-data
if %ERRORLEVEL% EQU 0 (
    echo [32m✓ Data fetching completed[0m
) else (
    echo [33m⚠ Data fetching completed with some errors[0m
)
echo.

REM Step 2: Transform to unified format
echo Step 2: Transforming to unified format...
echo -------------------------------------------
call npm run populate-unified
if %ERRORLEVEL% EQU 0 (
    echo [32m✓ Data transformation completed[0m
) else (
    echo [33m⚠ Data transformation completed with some errors[0m
)
echo.

REM Step 3: Generate manifest
echo Step 3: Generating data manifest...
echo -------------------------------------------
call npm run generate-manifest
if %ERRORLEVEL% EQU 0 (
    echo [32m✓ Manifest generation completed[0m
) else (
    echo [31m✗ Manifest generation failed[0m
)
echo.

REM Step 4: Validate data
echo Step 4: Validating data quality...
echo -------------------------------------------
call npm run validate-data
if %ERRORLEVEL% EQU 0 (
    echo [32m✓ Data validation completed[0m
) else (
    echo [33m⚠ Data validation found issues[0m
)
echo.

REM Summary
echo =========================================
echo Update Pipeline Complete!
echo =========================================
echo.
echo Summary files generated:
echo   - public/data/data-collection-summary.json
echo   - public/data/validation-report.json
echo   - public/data/manifest.json
echo.
echo Data locations:
echo   - Raw data: public/data/[source]/
echo   - Unified data: public/data/unified/
echo.
echo Next steps:
echo   1. Review summary files
echo   2. Check validation report
echo   3. Test in app: npm run dev
echo.

pause
