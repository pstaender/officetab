// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/source/analysis/analysishelper.cxx faithful
// @upstream scaddins/source/analysis/analysishelper.hxx faithful
// @upstream scaddins/source/analysis/analysisdefs.hxx faithful
// The helpers of the Analysis add-in: the date arithmetic (the add-in counts days from 0001-01-01),
// the coupon and bond helpers of the financial functions, the base conversions, the complex
// numbers, the CONVERT unit table, ScaDate and ScaAnyConverter.
// Port notes: C++ out parameters are returned (DaysToDate gives [day, month, year]) or passed as
// { value } objects (ScaAnyConverter::getDouble, getInt32). Overloads that differ only by a UNO
// type JavaScript cannot tell apart at run time are split into suffixed methods
// (ScaDoubleList::Append for an Any, a sequence<any> and a sequence<sequence<any>>; the same for
// ComplexList::Append). std::complex is replaced by the functions below (libstdc++'s formulas,
// division as GCC's __divdc3 does it). ScaAnyConverter reads strings with the port's number
// formatter (svl IsNumberFormat, en-US) where upstream uses the document's XNumberFormatter.

import { IllegalArgumentException, RuntimeException, type UnoAny, type UnoDate, type XPropertySet } from '../../../sc/inc/addincol.ts';
import { approxEqual, approxFloor, getN10Exp, isValidArcArg, rtl_math_ConversionStatus, round as rtl_math_round, stringToDouble, erf as rtl_math_erf, erfc as rtl_math_erfc } from '../../../sal/rtl/math.ts';
import { IsNumberFormat } from '../../../svl/source/numbers/zforlist.ts';
import * as Descr from '../../inc/analysis.ts';
import * as Names from '../../inc/strings.ts';
import * as DefNames from './deffuncname.ts';

// --- analysisdefs.hxx ------------------------------------------------------------------------------

export function isFreqInvalid(nFreq: number): boolean { return nFreq !== 1 && nFreq !== 2 && nFreq !== 4; }
export function finiteOrThrow(d: number): number
{
    if (!Number.isFinite(d))
        throw new IllegalArgumentException();
    return d;
}

// --- helpers of the port ---------------------------------------------------------------------------

/** rtl::math::pow10Exp */
function pow10Exp(fValue: number, nExp: number): number { return fValue * getN10Exp(nExp); }
/** C integer division */
const idiv = (a: number, b: number): number => Math.trunc(a / b);
/** static_cast<sal_uInt16> */
const u16 = (n: number): number => n & 0xFFFF;

/** std::complex<double> */
export interface StdComplex { re: number; im: number }
const cplx = (re: number, im: number): StdComplex => ({ re, im });
function c_mul(a: StdComplex, b: StdComplex): StdComplex { return cplx(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re); }
/** complex division as libgcc's __divdc3 (scaled by a power of two) */
function c_div(a: StdComplex, b: StdComplex): StdComplex
{
    const fMax = Math.max(Math.abs(b.re), Math.abs(b.im));
    let nScale = 1;
    if (Number.isFinite(fMax) && fMax > 0)
        nScale = Math.pow(2, -Math.floor(Math.log2(fMax)));
    const c = b.re * nScale, d = b.im * nScale;
    const fDenom = c * c + d * d;
    return cplx((a.re * c + a.im * d) / fDenom * nScale, (a.im * c - a.re * d) / fDenom * nScale);
}
const c_abs = (z: StdComplex): number => Math.hypot(z.re, z.im);
const c_arg = (z: StdComplex): number => Math.atan2(z.im, z.re);
const c_conj = (z: StdComplex): StdComplex => cplx(z.re, -z.im);
const c_exp = (z: StdComplex): StdComplex => { const e = Math.exp(z.re); return cplx(e * Math.cos(z.im), e * Math.sin(z.im)); };
const c_log = (z: StdComplex): StdComplex => cplx(Math.log(c_abs(z)), c_arg(z));
const c_log10 = (z: StdComplex): StdComplex => { const l = c_log(z); return cplx(l.re / Math.LN10, l.im / Math.LN10); };
function c_pow(z: StdComplex, y: number): StdComplex
{
    if (z.im === 0 && z.re > 0)
        return cplx(Math.pow(z.re, y), 0);
    const t = c_log(z);
    const r = Math.exp(y * t.re), theta = y * t.im;
    return cplx(r * Math.cos(theta), r * Math.sin(theta));
}
function c_sqrt(z: StdComplex): StdComplex
{
    const x = z.re, y = z.im;
    if (x === 0)
    {
        const t = Math.sqrt(Math.abs(y) / 2);
        return cplx(t, y < 0 ? -t : t);
    }
    const t = Math.sqrt(2 * (c_abs(z) + Math.abs(x)));
    const u = t / 2;
    return x > 0 ? cplx(u, y / t) : cplx(Math.abs(y) / t, y < 0 ? -u : u);
}
const c_sin = (z: StdComplex): StdComplex => cplx(Math.sin(z.re) * Math.cosh(z.im), Math.cos(z.re) * Math.sinh(z.im));
const c_cos = (z: StdComplex): StdComplex => cplx(Math.cos(z.re) * Math.cosh(z.im), -Math.sin(z.re) * Math.sinh(z.im));
const c_sinh = (z: StdComplex): StdComplex => cplx(Math.sinh(z.re) * Math.cos(z.im), Math.cosh(z.re) * Math.sin(z.im));
const c_cosh = (z: StdComplex): StdComplex => cplx(Math.cosh(z.re) * Math.cos(z.im), Math.sinh(z.re) * Math.sin(z.im));
function c_tan(z: StdComplex): StdComplex
{
    // as glibc's ctan
    const x = z.re, y = z.im;
    if (Math.abs(y) > 354)
        return cplx(4 * Math.sin(x) * Math.cos(x) * Math.exp(-2 * Math.abs(y)), Math.sign(y) || 1);
    const fSinhY = Math.sinh(y), fCos = Math.cos(x);
    const fDen = fCos * fCos + fSinhY * fSinhY;
    return cplx(Math.sin(x) * fCos / fDen, fSinhY * Math.sqrt(1 + fSinhY * fSinhY) / fDen);
}
const c_inv = (z: StdComplex): StdComplex => c_div(cplx(1.0, 0.0), z);

const M_LOG2E = Math.LOG2E;

/** printf's "%.*g" ("%+.*g" with bLeadingSign) */
function printf_g(f: number, nPrec: number, bLeadingSign: boolean): string
{
    let aRet: string;
    if (f === 0)
        aRet = Object.is(f, -0) ? '-0' : '0';
    else
    {
        const P = nPrec === 0 ? 1 : nPrec;
        const aExp = f.toExponential(P - 1);
        const X = Number(aExp.slice(aExp.indexOf('e') + 1));
        const strip = (s: string) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);
        if (P > X && X >= -4)
            aRet = strip(f.toFixed(P - 1 - X));
        else
        {
            const aMant = strip(aExp.slice(0, aExp.indexOf('e')));
            const nAbsExp = Math.abs(X);
            aRet = `${aMant}e${X < 0 ? '-' : '+'}${nAbsExp < 10 ? '0' : ''}${nAbsExp}`;
        }
    }
    if (bLeadingSign && !aRet.startsWith('-'))
        aRet = '+' + aRet;
    return aRet;
}

// --- analysishelper.cxx ------------------------------------------------------------------------------

const UNIQUE = false;   // function name does not exist in Calc
const DOUBLE = true;    // function name exists in Calc

const STDPAR = false;   // all parameters are described
const INTPAR = true;    // first parameter is internal

const INV_MATCHLEV = 1764; // guess, what this is... :-) - I doubt this kind of comment looks fun :-(

export const FDCategory = {
    DateTime: 0,
    Finance: 1,
    Inf: 2,
    Math: 3,
    Tech: 4,
} as const;
export type FDCategory = (typeof FDCategory)[keyof typeof FDCategory];

export interface FuncDataBase
{
    pIntName: string;
    pUINameID: string;                  // resource ID to UI name
    pDescrID: readonly string[];        // resource ID to description, parameter names and ~ description
    bDouble: boolean;                   // name already exist in Calc
    bWithOpt: boolean;                  // first parameter is internal
    pCompListID: readonly string[];     // list of valid names
    nNumOfParams: number;               // number of named / described parameters
    eCat: FDCategory;                   // function category
    pSuffix: string | null;             // if bDouble, append a suffix other than "_ADD" for UI
}

function FUNCDATA(FUNCNAME: string, DBL: boolean, OPT: boolean, NUMOFPAR: number, CAT: FDCategory): FuncDataBase
{
    return FUNCDATAS(FUNCNAME, DBL, OPT, NUMOFPAR, CAT, null);
}

function FUNCDATAS(FUNCNAME: string, DBL: boolean, OPT: boolean, NUMOFPAR: number, CAT: FDCategory, SUFFIX: string | null): FuncDataBase
{
    return { pIntName: 'get' + FUNCNAME, pUINameID: (Names as Record<string, unknown>)['ANALYSIS_FUNCNAME_' + FUNCNAME] as string,
        pDescrID: (Descr as Record<string, unknown>)['ANALYSIS_' + FUNCNAME] as readonly string[], bDouble: DBL, bWithOpt: OPT,
        pCompListID: (DefNames as Record<string, unknown>)['ANALYSIS_DEFFUNCNAME_' + FUNCNAME] as readonly string[], nNumOfParams: NUMOFPAR, eCat: CAT, pSuffix: SUFFIX };
}

const pFuncDatas: readonly FuncDataBase[] =
[
    //                          UNIQUE or   INTPAR or
    //         function name     DOUBLE      STDPAR     # of param  category
    FUNCDATA( 'Workday',          UNIQUE,     INTPAR,     3,          FDCategory.DateTime ),
    FUNCDATA( 'Yearfrac',         UNIQUE,     INTPAR,     3,          FDCategory.DateTime ),
    FUNCDATA( 'Edate',            UNIQUE,     INTPAR,     2,          FDCategory.DateTime ),
    FUNCDATAS( 'Weeknum',         DOUBLE,     INTPAR,     2,          FDCategory.DateTime, '_EXCEL2003' ),
    FUNCDATA( 'Eomonth',          UNIQUE,     INTPAR,     2,          FDCategory.DateTime ),
    FUNCDATAS( 'Networkdays',     DOUBLE,     INTPAR,     3,          FDCategory.DateTime, '_EXCEL2003' ),
    FUNCDATA( 'Iseven',           DOUBLE,     STDPAR,     1,          FDCategory.Inf ),
    FUNCDATA( 'Isodd',            DOUBLE,     STDPAR,     1,          FDCategory.Inf ),
    FUNCDATA( 'Multinomial',      UNIQUE,     STDPAR,     1,          FDCategory.Math ),
    FUNCDATA( 'Seriessum',        UNIQUE,     STDPAR,     4,          FDCategory.Math ),
    FUNCDATA( 'Quotient',         UNIQUE,     STDPAR,     2,          FDCategory.Math ),
    FUNCDATA( 'Mround',           UNIQUE,     STDPAR,     2,          FDCategory.Math ),
    FUNCDATA( 'Sqrtpi',           UNIQUE,     STDPAR,     1,          FDCategory.Math ),
    FUNCDATA( 'Randbetween',      UNIQUE,     STDPAR,     2,          FDCategory.Math ),
    FUNCDATAS( 'Gcd',             DOUBLE,     INTPAR,     1,          FDCategory.Math, '_EXCEL2003' ),
    FUNCDATAS( 'Lcm',             DOUBLE,     INTPAR,     1,          FDCategory.Math, '_EXCEL2003' ),
    FUNCDATA( 'Besseli',          UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Besselj',          UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Besselk',          UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Bessely',          UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Bin2Oct',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Bin2Dec',          UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Bin2Hex',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Oct2Bin',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Oct2Dec',          UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Oct2Hex',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Dec2Bin',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Dec2Hex',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Dec2Oct',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Hex2Bin',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Hex2Dec',          UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Hex2Oct',          UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Delta',            UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Erf',              UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Erfc',             UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Gestep',           UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Factdouble',       UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imabs',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imaginary',        UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Impower',          UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Imargument',       UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imcos',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imdiv',            UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Imexp',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imconjugate',      UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imln',             UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imlog10',          UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imlog2',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Improduct',        UNIQUE,     INTPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Imreal',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsin',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsub',            UNIQUE,     STDPAR,     2,          FDCategory.Tech ),
    FUNCDATA( 'Imsqrt',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsum',            UNIQUE,     INTPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imtan',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsec',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imcsc',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imcot',            UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsinh',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imcosh',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imsech',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Imcsch',           UNIQUE,     STDPAR,     1,          FDCategory.Tech ),
    FUNCDATA( 'Complex',          UNIQUE,     STDPAR,     3,          FDCategory.Tech ),
    FUNCDATA( 'Convert',          UNIQUE,     STDPAR,     3,          FDCategory.Tech ),
    FUNCDATA( 'Amordegrc',        UNIQUE,     INTPAR,     7,          FDCategory.Finance ),
    FUNCDATA( 'Amorlinc',         UNIQUE,     INTPAR,     7,          FDCategory.Finance ),
    FUNCDATA( 'Accrint',          UNIQUE,     INTPAR,     7,          FDCategory.Finance ),
    FUNCDATA( 'Accrintm',         UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Received',         UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Disc',             UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Duration',         UNIQUE,     INTPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Effect',           DOUBLE,     STDPAR,     2,          FDCategory.Finance ),
    FUNCDATA( 'Cumprinc',         DOUBLE,     STDPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Cumipmt',          DOUBLE,     STDPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Price',            UNIQUE,     INTPAR,     7,          FDCategory.Finance ),
    FUNCDATA( 'Pricedisc',        UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Pricemat',         UNIQUE,     INTPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Mduration',        UNIQUE,     INTPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Nominal',          DOUBLE,     STDPAR,     2,          FDCategory.Finance ),
    FUNCDATA( 'Dollarfr',         UNIQUE,     STDPAR,     2,          FDCategory.Finance ),
    FUNCDATA( 'Dollarde',         UNIQUE,     STDPAR,     2,          FDCategory.Finance ),
    FUNCDATA( 'Yield',            UNIQUE,     INTPAR,     7,          FDCategory.Finance ),
    FUNCDATA( 'Yielddisc',        UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Yieldmat',         UNIQUE,     INTPAR,     6,          FDCategory.Finance ),
    FUNCDATA( 'Tbilleq',          UNIQUE,     INTPAR,     3,          FDCategory.Finance ),
    FUNCDATA( 'Tbillprice',       UNIQUE,     INTPAR,     3,          FDCategory.Finance ),
    FUNCDATA( 'Tbillyield',       UNIQUE,     INTPAR,     3,          FDCategory.Finance ),
    FUNCDATA( 'Oddfprice',        UNIQUE,     INTPAR,     9,          FDCategory.Finance ),
    FUNCDATA( 'Oddfyield',        UNIQUE,     INTPAR,     9,          FDCategory.Finance ),
    FUNCDATA( 'Oddlprice',        UNIQUE,     INTPAR,     8,          FDCategory.Finance ),
    FUNCDATA( 'Oddlyield',        UNIQUE,     INTPAR,     8,          FDCategory.Finance ),
    FUNCDATA( 'Xirr',             UNIQUE,     INTPAR,     3,          FDCategory.Finance ),
    FUNCDATA( 'Xnpv',             UNIQUE,     STDPAR,     3,          FDCategory.Finance ),
    FUNCDATA( 'Intrate',          UNIQUE,     INTPAR,     5,          FDCategory.Finance ),
    FUNCDATA( 'Coupncd',          UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Coupdays',         UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Coupdaysnc',       UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Coupdaybs',        UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Couppcd',          UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Coupnum',          UNIQUE,     INTPAR,     4,          FDCategory.Finance ),
    FUNCDATA( 'Fvschedule',       UNIQUE,     STDPAR,     2,          FDCategory.Finance )
];

export function IsLeapYear( n: number ): boolean
{
    return ( (( ( n % 4 ) === 0 ) && ( ( n % 100 ) !== 0)) || ( ( n % 400 ) === 0 ) );
}

const aDaysInMonth = [ 0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];

export function DaysInMonth( nMonth: number, nYear: number ): number
{
    if( (nMonth === 2) && IsLeapYear( nYear ) )
        return 29;
    return aDaysInMonth[ nMonth ]!;
}


/**
 * Convert a date to a count of days starting from 01/01/0001
 *
 * The internal representation of a Date used in this Addin
 * is the number of days between 01/01/0001 and the date
 * this function converts a Day , Month, Year representation
 * to this internal Date value.
 *
 */

export function DateToDays( nDay: number, nMonth: number, nYear: number ): number
{
    let nDays = (nYear-1) * 365;
    nDays += idiv(nYear-1, 4) - idiv(nYear-1, 100) + idiv(nYear-1, 400);

    for( let i = 1; i < nMonth; i++ )
        nDays += DaysInMonth(i,nYear);
    nDays += nDay;

    return nDays;
}


/**
 * Convert a count of days starting from 01/01/0001 to a date
 *
 * The internal representation of a Date used in this Addin
 * is the number of days between 01/01/0001 and the date
 * this function converts this internal Date value
 * to a Day , Month, Year representation of a Date.
 *
 * Returns [ rDay, rMonth, rYear ].
 */

export function DaysToDate( nDays: number ): [number, number, number]
{
    if( nDays < 0 )
        throw new IllegalArgumentException();
    let nTempDays: number;
    let i = 0;
    let bCalc: boolean;
    let rYear: number;

    do
    {
        nTempDays = nDays;
        const nTempYear = idiv(nTempDays, 365);
        if (nTempYear > 32767)
            throw new IllegalArgumentException("days value too large " + nDays);
        rYear = u16(nTempYear - i);
        nTempDays -= (rYear -1) * 365;
        nTempDays -= idiv( rYear -1, 4) - idiv( rYear -1, 100) + idiv(rYear -1, 400);
        bCalc = false;
        if ( nTempDays < 1 )
        {
            i++;
            bCalc = true;
        }
        else
        {
            if ( nTempDays > 365 )
            {
                if ( (nTempDays !== 366) || !IsLeapYear( rYear ) )
                {
                    i--;
                    bCalc = true;
                }
            }
        }
    }
    while ( bCalc );

    let rMonth = 1;
    while ( nTempDays > DaysInMonth( rMonth, rYear ) )
    {
        nTempDays -= DaysInMonth( rMonth, rYear );
        rMonth++;
    }
    const rDay = u16(nTempDays);
    return [ rDay, rMonth, rYear ];
}


/**
 * Get the null date used by the spreadsheet document
 *
 * The internal representation of a Date used in this Addin
 * is the number of days between 01/01/0001 and the date
 * this function returns this internal Date value for the document null date
 *
 */

export function GetNullDate( xOpt: XPropertySet | null | undefined ): number
{
    if( xOpt )
    {
        try
        {
            const aAny = xOpt.getPropertyValue( "NullDate" ) as UnoDate | undefined;
            if( aAny && typeof aAny === 'object' && 'Day' in aAny )
                return DateToDays( aAny.Day, aAny.Month, aAny.Year );
        }
        catch
        {
        }
    }

    // no null date available -> no calculations possible
    throw new RuntimeException();
}


export function GetDiffDate360(
                nDay1: number, nMonth1: number, nYear1: number, bLeapYear1: boolean,
                nDay2: number, nMonth2: number, nYear2: number,
                bUSAMethod: boolean ): number;
export function GetDiffDate360( nNullDate: number | XPropertySet | null | undefined, nDate1: number, nDate2: number, bUSAMethod: boolean ): number;
export function GetDiffDate360( ...a: unknown[] ): number
{
    if( a.length === 4 )
    {
        // GetDiffDate360( nNullDate, nDate1, nDate2, bUSAMethod ), or with the options (inline in analysishelper.hxx)
        const nNullDate = typeof a[0] === 'number' ? a[0] : GetNullDate( a[0] as XPropertySet );
        let nDate1 = a[1] as number, nDate2 = a[2] as number;
        const bUSAMethod = a[3] as boolean;

        nDate1 += nNullDate;
        nDate2 += nNullDate;

        const [ nDay1, nMonth1, nYear1 ] = DaysToDate( nDate1 );
        const [ nDay2, nMonth2, nYear2 ] = DaysToDate( nDate2 );

        return GetDiffDate360( nDay1, nMonth1, nYear1, IsLeapYear( nYear1 ), nDay2, nMonth2, nYear2, bUSAMethod );
    }

    let nDay1 = a[0] as number;
    const nMonth1 = a[1] as number, nYear1 = a[2] as number, bLeapYear1 = a[3] as boolean;
    let nDay2 = a[4] as number, nMonth2 = a[5] as number, nYear2 = a[6] as number;
    const bUSAMethod = a[7] as boolean;

    if( nDay1 === 31 )
        nDay1--;
    else if( bUSAMethod && ( nMonth1 === 2 && ( nDay1 === 29 || ( nDay1 === 28 && !bLeapYear1 ) ) ) )
            nDay1 = 30;

    if( nDay2 === 31 )
    {
        if( bUSAMethod && nDay1 !== 30 )
        {
            nDay2 = 1;
            if( nMonth2 === 12 )
            {
                nYear2++;
                nMonth2 = 1;
            }
            else
                nMonth2++;
        }
        else
            nDay2 = 30;
    }

    return nDay2 + nMonth2 * 30 + nYear2 * 360 - nDay1 - nMonth1 * 30 - nYear1 * 360;
}


export function GetDaysInYears( nYear1: number, nYear2: number ): number
{
    let nLeaps = 0;
    for( let n = nYear1 ; n <= nYear2 ; n++ )
    {
        if( IsLeapYear( n ) )
            nLeaps++;
    }

    let nSum = 1;
    nSum += nYear2;
    nSum -= nYear1;
    nSum *= 365;
    nSum += nLeaps;

    return nSum;
}


/** monday = 0, ..., sunday = 6 */
export function GetDayOfWeek( n: number ): number
{
    return ( n - 1 ) % 7;
}


/** pOptDaysIn1stYear receives the days in the first year when given. */
export function GetDiffDate( nNullDate: number, nStartDate: number, nEndDate: number, nMode: number,
    pOptDaysIn1stYear?: { value: number } ): number
{
    const bNeg = nStartDate > nEndDate;

    if( bNeg )
        [ nStartDate, nEndDate ] = [ nEndDate, nStartDate ];

    let nRet: number;

    switch( nMode )
    {
        case 0:         // 0=USA (NASD) 30/360
        case 4:         // 4=Europe 30/360
            {
            nStartDate += nNullDate;
            nEndDate += nNullDate;

            const [ nD1, nM1, nY1 ] = DaysToDate( nStartDate );
            const [ nD2, nM2, nY2 ] = DaysToDate( nEndDate );

            const bLeap = IsLeapYear( nY1 );
            let nMonths: number;

            nMonths = nM2 - nM1;
            const nDays = nD2 - nD1;

            nMonths += ( nY2 - nY1 ) * 12;

            nRet = nMonths * 30 + nDays;
            if( nMode === 0 && nM1 === 2 && nM2 !== 2 && nY1 === nY2 )
                nRet -= bLeap? 1 : 2;

            if( pOptDaysIn1stYear )
                pOptDaysIn1stYear.value = 360;
            }
            break;
        case 1:         // 1=exact/exact
            if( pOptDaysIn1stYear )
            {
                const [ , , nY ] = DaysToDate( nStartDate + nNullDate );

                pOptDaysIn1stYear.value = IsLeapYear( nY )? 366 : 365;
            }
            nRet = nEndDate - nStartDate;
            break;
        case 2:         // 2=exact/360
            nRet = nEndDate - nStartDate;
            if( pOptDaysIn1stYear )
                pOptDaysIn1stYear.value = 360;
            break;
        case 3:         //3=exact/365
            nRet = nEndDate - nStartDate;
            if( pOptDaysIn1stYear )
                pOptDaysIn1stYear.value = 365;
            break;
        default:
            throw new IllegalArgumentException();
    }

    return bNeg? -nRet : nRet;
}


export function GetYearDiff( nNullDate: number, nStartDate: number, nEndDate: number, nMode: number ): number
{
    const nDays1stYear = { value: 0 };
    const nTotalDays = GetDiffDate( nNullDate, nStartDate, nEndDate, nMode, nDays1stYear );

    return nTotalDays / nDays1stYear.value;
}


export function GetDaysInYear( nNullDate: number, nDate: number, nMode: number ): number
{
    switch( nMode )
    {
        case 0:         // 0=USA (NASD) 30/360
        case 2:         // 2=exact/360
        case 4:         // 4=Europe 30/360
            return 360;
        case 1:         // 1=exact/exact
            {
            nDate += nNullDate;
            const [ , , nY ] = DaysToDate( nDate );
            return IsLeapYear( nY )? 366 : 365;
            }
        case 3:         //3=exact/365
            return 365;
        default:
            throw new IllegalArgumentException();
    }
}


// tdf69569 making code compliant with change request for ODFF1.2 par 4.11.7.7
/**
 * Function GetYearFrac implements YEARFRAC as defined in:
 *   Open Document Format for Office Applications version 1.2 Part 2, par. 6.10.24
 *   The calculations are defined in:
 *   Open Document Format for Office Applications version 1.2 Part 2, par. 4.11.7
 *
 * The first argument is the null date, or the options to read it from (the inline overload of
 * analysishelper.hxx).
 */
export function GetYearFrac( nNullDateOrOpt: number | XPropertySet | null | undefined, nStartDate: number, nEndDate: number, nMode: number ): number
{
    const nNullDate = typeof nNullDateOrOpt === 'number' ? nNullDateOrOpt : GetNullDate( nNullDateOrOpt );

    if( nStartDate === nEndDate )
        return 0.0;     // nothing to do...

    if( nStartDate > nEndDate )
        [ nStartDate, nEndDate ] = [ nEndDate, nStartDate ];

    const nDate1 = nStartDate + nNullDate;
    const nDate2 = nEndDate + nNullDate;

    let [ nDay1, nMonth1, nYear1 ] = DaysToDate( nDate1 );
    let [ nDay2, nMonth2, nYear2 ] = DaysToDate( nDate2 );

    // calculate days between nDate1 and nDate2
    let nDayDiff: number;
    switch( nMode )
    {
        case 0:         // 0=USA (NASD) 30/360
            if ( nDay1 === 31 )
            {
                nDay1--;
            }
            if ( nDay1 === 30 && nDay2 === 31 )
            {
                nDay2--;
            }
            else
            {
                if ( nMonth1 === 2 && nDay1 === ( IsLeapYear( nYear1 ) ? 29 : 28 ) )
                {
                    nDay1 = 30;
                    if ( nMonth2 === 2 && nDay2 === ( IsLeapYear( nYear2 ) ? 29 : 28 ) )
                    {
                        nDay2 = 30;
                    }
                }
            }
            nDayDiff = ( nYear2 - nYear1 ) * 360 + ( nMonth2 - nMonth1 ) * 30 + ( nDay2 - nDay1 );
            break;
        case 1:         // 1=exact/exact
        case 2:         // 2=exact/360
        case 3:         // 3=exact/365
            nDayDiff = nDate2 - nDate1;
            break;
        case 4:         // 4=Europe 30/360
            if ( nDay1 === 31 )
            {
                nDay1--;
            }
            if ( nDay2 === 31 )
            {
                nDay2--;
            }
            nDayDiff = ( nYear2 - nYear1 ) * 360 + ( nMonth2 - nMonth1 ) * 30 + ( nDay2 - nDay1 );
            break;
        default:
            throw new IllegalArgumentException();
    }

    //calculate days in year
    let nDaysInYear: number;
    switch( nMode )
    {
        case 0:         // 0=USA (NASD) 30/360
        case 2:         // 2=exact/360
        case 4:         // 4=Europe 30/360
            nDaysInYear = 360;
            break;
        case 1:         // 1=exact/exact
            {
                const isYearDifferent = ( nYear1 !== nYear2 );
                // ODFv1.2 part 2 section 4.11.7.7.7
                if ( isYearDifferent &&
                     ( ( nYear2 !== nYear1 + 1 ) ||
                       ( nMonth1 < nMonth2 ) ||
                       ( nMonth1 === nMonth2 && nDay1 < nDay2 ) ) )
                {
                    // return average of days in year between nDate1 and nDate2, inclusive
                    let nDayCount = 0;
                    for ( let i = nYear1; i <= nYear2; i++ )
                        nDayCount += ( IsLeapYear( i ) ? 366 : 365 );

                    nDaysInYear = nDayCount / ( nYear2 - nYear1 + 1 );
                }
                else
                {
                    // as a consequence, !isYearDifferent or
                    // nYear2 == nYear + 1 and (nMonth1 > nMonth2 or
                    // (nMonth1 == nMonth2 and nDay1 >= nDay2))

                    // ODFv1.2 part 2 section 4.11.7.7.8 (CHANGE REQUEST PENDING, see tdf6959)
                    if ( !isYearDifferent && IsLeapYear( nYear1 ) )
                    {
                        nDaysInYear = 366;
                    }
                    else
                    {
                        // ODFv1.2 part 2 section 4.11.7.7.9/10 (CHANGE REQUEST PENDING, see tdf69569)
                        // we need to determine whether there is a 29 February
                        // between nDate1 (inclusive) and nDate2 (inclusive)
                        // the case of nYear1 == nYear2 is adequately tested in previous test
                        if( isYearDifferent &&
                            ( ( IsLeapYear( nYear1 ) &&
                                ( ( nMonth1 < 2 ) || ( ( nMonth1 === 2 ) && ( nDay1 <= 29 ) ) ) ) ||
                              ( IsLeapYear( nYear2 ) &&
                                ( nMonth2 > 2 || ( ( nMonth2 === 2 ) && ( nDay2 === 29 ) ) ) ) ) )
                        {
                            nDaysInYear = 366;
                        }
                        else
                        {
                            nDaysInYear = 365;
                        }
                    }
                }
            }
            break;
        case 3:         // 3=exact/365
            nDaysInYear = 365;
            break;
        // coverity[dead_error_begin] - following conditions exist to avoid compiler warning
        default:
            throw new IllegalArgumentException();
    }

    return nDayDiff / nDaysInYear;
}

export function BinomialCoefficient( n: number, k: number ): number
{
    // This method is a copy of BinomCoeff()
    // found in sc/source/core/tool/interpr3.cxx

    let nVal = 0.0;
    k = approxFloor(k);
    if (n < k)
        nVal = 0.0;
    else if (k === 0.0)
        nVal = 1.0;
    else
    {
        nVal = n/k;
        n--;
        k--;
        while (k > 0.0)
        {
            nVal *= n/k;
            k--;
            n--;
        }
    }
    return nVal;
}

/** C's fmod */
const fmod = (a: number, b: number): number => a % b;

export function GetGcd( f1: number, f2: number ): number
{
    let f = fmod( f1, f2 );
    while( f > 0.0 )
    {
        f1 = f2;
        f2 = f;
        f = fmod( f1, f2 );
    }

    return f2;
}


export function ConvertToDec( aStr: string, nBase: number, nCharLim: number ): number
{
    if ( nBase < 2 || nBase > 36 )
        throw new IllegalArgumentException();

    const nStrLen = aStr.length;
    if( nStrLen > nCharLim )
        throw new IllegalArgumentException();
    else if( !nStrLen )
        return 0.0;

    let fVal = 0.0;

    let p = 0;

    let nFirstDig = 0;
    let bFirstDig = true;
    const fBase = nBase;

    while ( p < aStr.length && aStr.charCodeAt( p ) !== 0 )
    {
        let n: number;
        const c = aStr[p]!;

        if( '0' <= c && c <= '9' )
            n = c.charCodeAt( 0 ) - 48;
        else if( 'A' <= c && c <= 'Z' )
            n = 10 + ( c.charCodeAt( 0 ) - 65 );
        else if ( 'a' <= c && c <= 'z' )
            n = 10 + ( c.charCodeAt( 0 ) - 97 );
        else
            n = nBase;

        if( n >= nBase )
            throw new IllegalArgumentException(); // illegal char!

        if( bFirstDig )
        {
            bFirstDig = false;
            nFirstDig = n;
        }
        fVal = fVal * fBase + n;

        p++;

    }

    if( nStrLen === nCharLim && !bFirstDig && (nFirstDig >= idiv( nBase, 2 )) )
    {   // handling negative values
        fVal = ( Math.pow( nBase, nCharLim ) - fVal );   // complement
        fVal *= -1.0;
    }

    return fVal;
}


function GetMaxChar( nBase: number ): string
{
    const c = "--123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return c[ nBase ]!;
}


export function ConvertFromDec( fNum: number, fMin: number, fMax: number, nBase: number,
    nPlaces: number, nMaxPlaces: number, bUsePlaces: boolean ): string
{
    fNum = approxFloor( fNum );
    fMin = approxFloor( fMin );
    fMax = approxFloor( fMax );

    if( fNum < fMin || fNum > fMax || ( bUsePlaces && ( nPlaces <= 0 || nPlaces > nMaxPlaces ) ) )
        throw new IllegalArgumentException();

    let nNum = Math.trunc( fNum );
    const bNeg = nNum < 0;
    if( bNeg )
        nNum = Math.trunc( Math.pow( nBase, nMaxPlaces ) ) + nNum;

    let aRet = nNum.toString( nBase ).toUpperCase();


    if( bUsePlaces )
    {
        const nLen = aRet.length;
        if( !bNeg && nLen > nPlaces )
        {
            throw new IllegalArgumentException();
        }
        else if( ( bNeg && nLen < nMaxPlaces ) || ( !bNeg && nLen < nPlaces ) )
        {
            const nLeft = nPlaces - nLen;
            const p = ( bNeg ? GetMaxChar( nBase ) : '0' ).repeat( Math.max( nLeft, 0 ) );
            aRet = p + aRet;
        }
    }

    return aRet;
}

export function Erf( x: number ): number
{
    return rtl_math_erf(x);
}

export function Erfc( x: number ): number
{
    return rtl_math_erfc(x);
}

function IsNum( c: string ): boolean
{
    return c >= '0' && c <= '9';
}


function IsComma( c: string ): boolean
{
    return c === '.' || c === ',';
}


function IsExpStart( c: string ): boolean
{
    return c === 'e' || c === 'E';
}


function IsImagUnit( c: string ): boolean
{
    return c === 'i' || c === 'j';
}


function GetVal( c: string ): number
{
    return c.charCodeAt( 0 ) - 48;
}


/** A position in a string, read as a C string: past the end is the terminating '\0'. */
export class StrCursor
{
    s: string;
    p: number;
    constructor( s: string, p = 0 ) { this.s = s; this.p = p; }
    at( n = 0 ): string { return this.s[ this.p + n ] ?? '\0'; }
}

/** rp is moved to the last character read; the result is the value, or null if there is none. */
export function ParseDouble( rp: StrCursor ): number | null
{
    let fInt = 0.0;
    let fFrac = 0.0;
    let fMult = 0.1;    // multiplier to multiply digits with, when adding fractional ones
    let nExp = 0;
    const nMaxExp = 307;
    let nDigCnt = 18;   // max. number of digits to read in, rest doesn't matter

    const S_End = 0, S_Sign = 1, S_IntStart = 2, S_Int = 3, S_IgnoreIntDigs = 4, S_Frac = 5, S_IgnoreFracDigs = 6, S_ExpSign = 7, S_Exp = 8;

    let eS = S_Sign;

    let bNegNum = false;
    let bNegExp = false;

    let p = rp.p;
    let c: string;

    while( eS !== S_End )
    {
        c = rp.s[ p ] ?? '\0';
        switch( eS )
        {
            case S_Sign:
                if( IsNum( c ) )
                {
                    fInt = GetVal( c );
                    nDigCnt--;
                    eS = S_Int;
                }
                else if( c === '-' )
                {
                    bNegNum = true;
                    eS = S_IntStart;
                }
                else if( c === '+' )
                    eS = S_IntStart;
                else if( IsComma( c ) )
                    eS = S_Frac;
                else
                    return null;
                break;
            case S_IntStart:
                if( IsNum( c ) )
                {
                    fInt = GetVal( c );
                    nDigCnt--;
                    eS = S_Int;
                }
                else if( IsComma( c ) )
                    eS = S_Frac;
                else if( IsImagUnit( c ) )
                {
                    return 0.0;
                }
                else
                    return null;
                break;
            case S_Int:
                if( IsNum( c ) )
                {
                    fInt *= 10.0;
                    fInt += GetVal( c );
                    nDigCnt--;
                    if( !nDigCnt )
                        eS = S_IgnoreIntDigs;
                }
                else if( IsComma( c ) )
                    eS = S_Frac;
                else if( IsExpStart( c ) )
                    eS = S_ExpSign;
                else
                    eS = S_End;
                break;
            case S_IgnoreIntDigs:
                if( IsNum( c ) )
                    nExp++;         // just multiply num with 10... ;-)
                else if( IsComma( c ) )
                    eS = S_Frac;
                else if( IsExpStart( c ) )
                    eS = S_ExpSign;
                else
                    eS = S_End;
                break;
            case S_Frac:
                if( IsNum( c ) )
                {
                    fFrac += GetVal( c ) * fMult;
                    nDigCnt--;
                    if( nDigCnt )
                        fMult *= 0.1;
                    else
                        eS = S_IgnoreFracDigs;
                }
                else if( IsExpStart( c ) )
                    eS = S_ExpSign;
                else
                    eS = S_End;
                break;
            case S_IgnoreFracDigs:
                if( IsExpStart( c ) )
                    eS = S_ExpSign;
                else if( !IsNum( c ) )
                    eS = S_End;
                break;
            case S_ExpSign:
                if( IsNum( c ) )
                {
                    nExp = GetVal( c );
                    eS = S_Exp;
                }
                else if( c === '-' )
                {
                    bNegExp = true;
                    eS = S_Exp;
                }
                else if( c !== '+' )
                    eS = S_End;
                break;
            case S_Exp:
                if( IsNum( c ) )
                {
                    nExp *= 10;
                    nExp += GetVal( c );
                    if( nExp > nMaxExp )
                        return null;
                }
                else
                    eS = S_End;
                break;
            // coverity[dead_error_begin] - following conditions exist to avoid compiler warning
            case S_End:
                break;
        }

        p++;
    }

    p--;        // set pointer back to last
    rp.p = p;

    fInt += fFrac;

    if (fInt !== 0.0) // exact check; log10(0.0) may entail a pole error
    {
        const nLog10 = Math.trunc( Math.log10( fInt ) );

        if( bNegExp )
            nExp = -nExp;

        if( nLog10 + nExp > nMaxExp )
            return null;

        fInt = pow10Exp( fInt, nExp );
    }

    if( bNegNum )
        fInt = -fInt;

    return fInt;
}


export function GetString( f: number, bLeadingSign: boolean, nMaxDig = 15 ): string
{
    return printf_g( f, nMaxDig, bLeadingSign );
}


export function GetAmordegrc( nNullDate: number, fCost: number, nDate: number, nFirstPer: number,
    fRestVal: number, fPer: number, fRate: number, nBase: number ): number
{
    const nPer = Math.trunc( fPer ) >>> 0;
    const fUsePer = 1.0 / fRate;
    let fAmorCoeff: number;

    if( fUsePer < 3.0 )
        fAmorCoeff = 1.0;
    else if( fUsePer < 5.0 )
        fAmorCoeff = 1.5;
    else if( fUsePer <= 6.0 )
        fAmorCoeff = 2.0;
    else
        fAmorCoeff = 2.5;

    fRate *= fAmorCoeff;
    let fNRate = rtl_math_round( GetYearFrac( nNullDate, nDate, nFirstPer, nBase ) * fRate * fCost );
    fCost -= fNRate;
    let fRest = fCost - fRestVal;   // aboriginal cost - residual value - sum of all write-downs

    for( let n = 0 ; n < nPer ; n++ )
    {
        fNRate = rtl_math_round( fRate * fCost );
        fRest -= fNRate;

        if( fRest < 0.0 )
        {
            switch( nPer - n )
            {
                case 0:
                case 1:
                    return rtl_math_round( fCost * 0.5 );
                default:
                    return 0.0;
            }
        }

        fCost -= fNRate;
    }

    return fNRate;
}


export function GetAmorlinc( nNullDate: number, fCost: number, nDate: number, nFirstPer: number,
    fRestVal: number, fPer: number, fRate: number, nBase: number ): number
{
    const nPer = Math.trunc( fPer ) >>> 0;
    const fOneRate = fCost * fRate;
    const fCostDelta = fCost - fRestVal;
    const f0Rate = GetYearFrac( nNullDate, nDate, nFirstPer, nBase ) * fRate * fCost;
    const nNumOfFullPeriods = Math.trunc( ( fCost - fRestVal - f0Rate) / fOneRate ) >>> 0;

    let fResult = 0.0;
    if( nPer === 0 )
        fResult = f0Rate;
    else if( nPer <= nNumOfFullPeriods )
        fResult = fOneRate;
    else if( nPer === nNumOfFullPeriods + 1 )
        fResult = fCostDelta - fOneRate * nNumOfFullPeriods - f0Rate;

    if ( fResult > 0.0 )
        return fResult;
    else
        return 0.0;
}


export function GetDuration( nNullDate: number, nSettle: number, nMat: number, fCoup: number,
    fYield: number, nFreq: number, nBase: number ): number
{
    const fYearfrac = GetYearFrac( nNullDate, nSettle, nMat, nBase );
    const fNumOfCoups = GetCoupnum( nNullDate, nSettle, nMat, nFreq, nBase );
    let fDur = 0.0;
    const f100 = 100.0;
    fCoup *= f100 / nFreq;    // fCoup is used as cash flow
    fYield /= nFreq;
    fYield += 1.0;

    const nDiff = fYearfrac * nFreq - fNumOfCoups;

    let t: number;

    for( t = 1.0 ; t < fNumOfCoups ; t++ )
        fDur += ( t + nDiff ) * fCoup / Math.pow( fYield, t + nDiff );

    fDur += ( fNumOfCoups + nDiff ) * ( fCoup + f100 ) / Math.pow( fYield, fNumOfCoups + nDiff );

    let p = 0.0;
    for( t = 1.0 ; t < fNumOfCoups ; t++ )
        p += fCoup / Math.pow( fYield, t + nDiff );

    p += ( fCoup + f100 ) / Math.pow( fYield, fNumOfCoups + nDiff );

    fDur /= p;
    fDur /= nFreq;

    return fDur;
}


export function GetYieldmat( nNullDate: number, nSettle: number, nMat: number, nIssue: number,
    fRate: number, fPrice: number, nBase: number ): number
{
    const fIssMat = GetYearFrac( nNullDate, nIssue, nMat, nBase );
    const fIssSet = GetYearFrac( nNullDate, nIssue, nSettle, nBase );
    const fSetMat = GetYearFrac( nNullDate, nSettle, nMat, nBase );

    let y = 1.0 + fIssMat * fRate;
    y /= fPrice / 100.0 + fIssSet * fRate;
    y--;
    return y / fSetMat; // o3tl::div_allow_zero
}


export function GetOddfprice( _nNullDate: number, _nSettle: number, _nMat: number, _nIssue: number,
    _nFirstCoup: number, _fRate: number, _fYield: number, _fRedemp: number, _nFreq: number,
    _nBase: number ): number
{
    // If you change this to not unconditionally throw, the
    // SAL_WNOUNREACHABLE_CODE_PUSH/POP around the caller in
    // financial.cxx can be removed.
    throw new RuntimeException();
}


export function getYield_( nNullDate: number, nSettle: number, nMat: number, fCoup: number, fPrice: number,
                    fRedemp: number, nFreq: number, nBase: number ): number
{
    const fRate = fCoup;
    let fPriceN = 0.0;
    let fYield1 = 0.0;
    let fYield2 = 1.0;
    let fPrice1 = getPrice_( nNullDate, nSettle, nMat, fRate, fYield1, fRedemp, nFreq, nBase );
    let fPrice2 = getPrice_( nNullDate, nSettle, nMat, fRate, fYield2, fRedemp, nFreq, nBase );
    let fYieldN = ( fYield2 - fYield1 ) * 0.5;

    for( let nIter = 0 ; nIter < 100 && !approxEqual(fPriceN, fPrice) ; nIter++ )
    {
        fPriceN = getPrice_( nNullDate, nSettle, nMat, fRate, fYieldN, fRedemp, nFreq, nBase );

        if( approxEqual(fPrice, fPrice1) )
            return fYield1;
        else if( approxEqual(fPrice, fPrice2) )
            return fYield2;
        else if( approxEqual(fPrice, fPriceN) )
            return fYieldN;
        else if( fPrice < fPrice2 )
        {
            fYield2 *= 2.0;
            fPrice2 = getPrice_( nNullDate, nSettle, nMat, fRate, fYield2, fRedemp, nFreq, nBase );

            fYieldN = ( fYield2 - fYield1 ) * 0.5;
        }
        else
        {
            if( fPrice < fPriceN )
            {
                fYield1 = fYieldN;
                fPrice1 = fPriceN;
            }
            else
            {
                fYield2 = fYieldN;
                fPrice2 = fPriceN;
            }

            fYieldN = fYield2 - ( fYield2 - fYield1 ) * ( ( fPrice - fPrice2 ) / ( fPrice1 - fPrice2 ) );
        }
    }

    if( Math.abs( fPrice - fPriceN ) > fPrice / 100.0 )
        throw new IllegalArgumentException();      // result not precise enough

    return fYieldN;
}


export function getPrice_( nNullDate: number, nSettle: number, nMat: number, fRate: number, fYield: number,
                    fRedemp: number, nFreq: number, nBase: number ): number
{
    const fFreq = nFreq;

    const fE = GetCoupdays( nNullDate, nSettle, nMat, nFreq, nBase );
    const fDSC_E = GetCoupdaysnc( nNullDate, nSettle, nMat, nFreq, nBase ) / fE;
    const fN = GetCoupnum( nNullDate, nSettle, nMat, nFreq, nBase );
    const fA = GetCoupdaybs( nNullDate, nSettle, nMat, nFreq, nBase );

    let fRet = fRedemp / ( Math.pow( 1.0 + fYield / fFreq, fN - 1.0 + fDSC_E ) );
    fRet -= 100.0 * fRate / fFreq * fA / fE;

    const fT1 = 100.0 * fRate / fFreq;
    const fT2 = 1.0 + fYield / fFreq;

    for( let fK = 0.0 ; fK < fN ; fK++ )
        fRet += fT1 / Math.pow( fT2, fK + fDSC_E );

    return fRet;
}


export function GetOddfyield( _nNullDate: number, _nSettle: number, _nMat: number, _nIssue: number,
    _nFirstCoup: number, _fRate: number, _fPrice: number, _fRedemp: number, _nFreq: number,
    _nBase: number ): number
{
    // If you change this to not unconditionally throw, the
    // SAL_WNOUNREACHABLE_CODE_PUSH/POP around the caller in
    // financial.cxx can be removed.
    throw new RuntimeException();
}


export function GetOddlprice( nNullDate: number, nSettle: number, nMat: number, nLastCoup: number,
    fRate: number, fYield: number, fRedemp: number, nFreq: number, nBase: number ): number
{
    const fFreq = nFreq;
    const fDCi = GetYearFrac( nNullDate, nLastCoup, nMat, nBase ) * fFreq;
    const fDSCi = GetYearFrac( nNullDate, nSettle, nMat, nBase ) * fFreq;
    const fAi = GetYearFrac( nNullDate, nLastCoup, nSettle, nBase ) * fFreq;

    let p = fRedemp + fDCi * 100.0 * fRate / fFreq;
    p /= fDSCi * fYield / fFreq + 1.0;
    p -= fAi * 100.0 * fRate / fFreq;

    return p;
}


export function GetOddlyield( nNullDate: number, nSettle: number, nMat: number, nLastCoup: number,
    fRate: number, fPrice: number, fRedemp: number, nFreq: number, nBase: number ): number
{
    const fFreq = nFreq;
    const fDCi = GetYearFrac( nNullDate, nLastCoup, nMat, nBase ) * fFreq;
    const fDSCi = GetYearFrac( nNullDate, nSettle, nMat, nBase ) * fFreq;
    const fAi = GetYearFrac( nNullDate, nLastCoup, nSettle, nBase ) * fFreq;

    let y = fRedemp + fDCi * 100.0 * fRate / fFreq;
    y /= fPrice + fAi * 100.0 * fRate / fFreq;
    y--;
    return y * ( fFreq / fDSCi ); // o3tl::div_allow_zero
}


export function GetPmt( fRate: number, fNper: number, fPv: number, fFv: number, nPayType: number ): number
{
    let fPmt: number;
    if( fRate === 0.0 )
        fPmt = ( fPv + fFv ) / fNper;
    else
    {
        const fTerm = Math.pow( 1.0 + fRate, fNper );
        if( nPayType > 0 )
            fPmt = ( fFv * fRate / ( fTerm - 1.0 ) + fPv * fRate / ( 1.0 - 1.0 / fTerm ) ) / ( 1.0 + fRate );
        else
            fPmt = fFv * fRate / ( fTerm - 1.0 ) + fPv * fRate / ( 1.0 - 1.0 / fTerm );
    }

    return -fPmt;
}


export function GetFv( fRate: number, fNper: number, fPmt: number, fPv: number, nPayType: number ): number
{
    let fFv: number;
    if( fRate === 0.0 )
        fFv = fPv + fPmt * fNper;
    else
    {
        const fTerm = Math.pow( 1.0 + fRate, fNper );
        if( nPayType > 0 )
            fFv = fPv * fTerm + fPmt * ( 1.0 + fRate ) * ( fTerm - 1.0 ) / fRate;
        else
            fFv = fPv * fTerm + fPmt * ( fTerm - 1.0 ) / fRate;
    }

    return -fFv;
}

// financial functions COUP***

// COUPPCD: find last coupon date before settlement (can be equal to settlement)
function lcl_GetCouppcd( rDate: ScaDate, rSettle: ScaDate, rMat: ScaDate, nFreq: number ): void
{
    rDate.assign( rMat );
    rDate.setYear( rSettle.getYear() );
    if( rDate.lt( rSettle ) )
        rDate.addYears( 1 );
    while( rDate.gt( rSettle ) )
        rDate.addMonths( idiv( -12, nFreq ) );
}

export function GetCouppcd( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    const aDate = new ScaDate();
    lcl_GetCouppcd( aDate, new ScaDate( nNullDate, nSettle, nBase ), new ScaDate( nNullDate, nMat, nBase ), nFreq );
    return aDate.getDate( nNullDate );
}

// COUPNCD: find first coupon date after settlement (is never equal to settlement)
function lcl_GetCoupncd( rDate: ScaDate, rSettle: ScaDate, rMat: ScaDate, nFreq: number ): void
{
    rDate.assign( rMat );
    rDate.setYear( rSettle.getYear() );
    if( rDate.gt( rSettle ) )
        rDate.addYears( -1 );
    while( rDate.le( rSettle ) )
        rDate.addMonths( idiv( 12, nFreq ) );
}

export function GetCoupncd( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    const aDate = new ScaDate();
    lcl_GetCoupncd( aDate, new ScaDate( nNullDate, nSettle, nBase ), new ScaDate( nNullDate, nMat, nBase ), nFreq );
    return aDate.getDate( nNullDate );
}

// COUPDAYBS: get day count: coupon date before settlement <-> settlement
export function GetCoupdaybs( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    const aSettle = new ScaDate( nNullDate, nSettle, nBase );
    const aDate = new ScaDate();
    lcl_GetCouppcd( aDate, aSettle, new ScaDate( nNullDate, nMat, nBase ), nFreq );
    return ScaDate.getDiff( aDate, aSettle );
}

// COUPDAYSNC: get day count: settlement <-> coupon date after settlement
export function GetCoupdaysnc( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    if( (nBase !== 0) && (nBase !== 4) )
    {
        const aSettle = new ScaDate( nNullDate, nSettle, nBase );
        const aDate = new ScaDate();
        lcl_GetCoupncd( aDate, aSettle, new ScaDate( nNullDate, nMat, nBase ), nFreq );
        return ScaDate.getDiff( aSettle, aDate );
    }
    return GetCoupdays( nNullDate, nSettle, nMat, nFreq, nBase ) - GetCoupdaybs( nNullDate, nSettle, nMat, nFreq, nBase );
}

// COUPDAYS: get day count: coupon date before settlement <-> coupon date after settlement
export function GetCoupdays( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    if( nBase === 1 )
    {
        const aDate = new ScaDate();
        lcl_GetCouppcd( aDate, new ScaDate( nNullDate, nSettle, nBase ), new ScaDate( nNullDate, nMat, nBase ), nFreq );
        const aNextDate = new ScaDate( aDate );
        aNextDate.addMonths( idiv( 12, nFreq ) );
        return ScaDate.getDiff( aDate, aNextDate );
    }
    return GetDaysInYear( 0, 0, nBase ) / nFreq;
}

// COUPNUM: get count of coupon dates
export function GetCoupnum( nNullDate: number, nSettle: number, nMat: number, nFreq: number, nBase: number ): number
{
    if( nSettle >= nMat || isFreqInvalid(nFreq) )
        throw new IllegalArgumentException();

    const aMat = new ScaDate( nNullDate, nMat, nBase );
    const aDate = new ScaDate();
    lcl_GetCouppcd( aDate, new ScaDate( nNullDate, nSettle, nBase ), aMat, nFreq );
    const nMonths = u16( (aMat.getYear() - aDate.getYear()) * 12 + aMat.getMonth() - aDate.getMonth() );
    return idiv( nMonths * nFreq, 12 );
}

export class FuncData
{
    private aIntName: string;
    private pUINameID: string;
    private pDescrID: readonly string[];        // leads also to parameter descriptions!
    private bDouble: boolean;                   // flag for names that already exist in Calc
    private bWithOpt: boolean;                  // has internal parameter on first position

    private nParam: number;                     // num of parameters
    private aCompList: string[] = [];           // list of all valid names
    private eCat: FDCategory;                   // function category
    private aSuffix = '';                       // if bDouble and not empty, append a suffix other than "_ADD" for UI

    constructor( r: FuncDataBase )
    {
        this.aIntName = r.pIntName;
        this.pUINameID = r.pUINameID;
        this.pDescrID = r.pDescrID;
        this.bDouble = r.bDouble;
        this.bWithOpt = r.bWithOpt;
        this.nParam = r.nNumOfParams;
        this.eCat = r.eCat;
        if (r.pSuffix)
            this.aSuffix = r.pSuffix;

        this.aCompList.length = 2;
        this.aCompList[0] = r.pCompListID[0]!;
        this.aCompList[1] = r.pCompListID[1]!;
    }

    GetUINameID(): string { return this.pUINameID; }
    GetDescrID(): readonly string[] { return this.pDescrID; }
    IsDouble(): boolean { return this.bDouble; }
    GetSuffix(): string { return this.aSuffix; }

    GetStrIndex( nParamNum: number ): number
    {
        if( !this.bWithOpt )
            nParamNum++;

        if( nParamNum > this.nParam )
            return this.nParam * 2;
        else
            return nParamNum * 2;
    }

    Is( r: string ): boolean { return this.aIntName === r; }

    GetCompNameList(): readonly string[] { return this.aCompList; }

    GetCategory(): FDCategory { return this.eCat; }
}

export type FuncDataList = FuncData[];

export function InitFuncDataList( rList: FuncDataList ): void
{
    for( const rFuncData of pFuncDatas )
        rList.push( new FuncData( rFuncData ) );
}

/** Predicate for use with Array.prototype.find */
export function FindFuncData( rId: string ): ( rCandidate: FuncData ) => boolean
{
    return ( rCandidate ) => rCandidate.Is( rId );
}

/** a UNO Any holding a sequence< sequence< any > >: an array of rows */
function isAnySeqSeq( rAny: unknown ): rAny is UnoAny[][]
{
    return Array.isArray( rAny ) && rAny.every( ( r ) => Array.isArray( r ) );
}

/// sorted list with unique sal_Int32 values
export class SortedIndividualInt32List
{
    private maVector: number[] = [];

    /** Insert( sal_Int32 nDay ), or with the null date Insert( double fDay, nNullDate, bInsertOnWeekend )
        (which checks the range and calls the sal_Int32 overload). */
    private Insert( nDay: number, nNullDate?: number, bInsertOnWeekend?: boolean ): void
    {
        if( nNullDate === undefined )
        {
            let nIndex = this.Count();
            while( nIndex )
            {
                nIndex--;
                const nRef = this.Get( nIndex );
                if( nDay === nRef )
                    return;
                else if( nDay > nRef )
                {
                    this.maVector.splice( nIndex + 1, 0, nDay );
                    return;
                }
            }
            this.maVector.splice( 0, 0, nDay );
            return;
        }

        // Insert( double fDay, sal_Int32 nNullDate, bool bInsertOnWeekend )
        const fDay = nDay;
        if( (fDay < -2147483648.0) || (fDay > 2147483649.0) )
            throw new IllegalArgumentException();
        nDay = fDay | 0;

        // Insert( sal_Int32 nDay, sal_Int32 nNullDate, bool bInsertOnWeekend )
        if( !nDay )
            return;

        nDay += nNullDate;
        if( bInsertOnWeekend || (GetDayOfWeek( nDay ) < 5) )
            this.Insert( nDay );
    }

    Count(): number { return this.maVector.length; }

    /// @return  element on position nIndex or 0 on invalid index
    Get( n: number ): number { return this.maVector[n]!; }

    /// @return  true if nVal (internal date representation) is contained
    Find( nVal: number ): boolean
    {
        const nE = this.Count();

        if( !nE || nVal < this.Get( 0 ) || nVal > this.Get( nE - 1 ) )
            return false;

        // linear search

        for( let n = 0 ; n < nE ; n++ )
        {
            const nRef = this.Get( n );

            if( nRef === nVal )
                return true;
            else if( nRef > nVal )
                return false;
        }
        return false;
    }

    /** InsertHolidayList( rAnyConv, xOptions, rHolAny, nNullDate ): holidays on weekend are omitted.
        InsertHolidayList( rAnyConv, rHolAny, nNullDate, bInsertOnWeekend ): one value. */
    InsertHolidayList( rAnyConv: ScaAnyConverter, xOptions: XPropertySet | null | undefined, rHolAny: UnoAny, nNullDate: number ): void;
    InsertHolidayList( rAnyConv: ScaAnyConverter, rHolAny: UnoAny, nNullDate: number, bInsertOnWeekend: boolean ): void;
    InsertHolidayList( rAnyConv: ScaAnyConverter, a1: unknown, a2: unknown, a3: unknown ): void
    {
        if( typeof a3 === 'boolean' )
        {
            const rHolAny = a1 as UnoAny, nNullDate = a2 as number, bInsertOnWeekend = a3;
            const fDay = { value: 0 };
            if( rAnyConv.getDouble( fDay, rHolAny ) )
                this.Insert( fDay.value, nNullDate, bInsertOnWeekend );
            return;
        }

        const xOptions = a1 as XPropertySet | null | undefined, rHolAny = a2 as UnoAny, nNullDate = a3 as number;
        rAnyConv.init( xOptions );
        if( Array.isArray( rHolAny ) )
        {
            if( !isAnySeqSeq( rHolAny ) )
                throw new IllegalArgumentException();
            const aAnySeq = rHolAny;

            for (const rSubSeq of aAnySeq)
            {
                for( const rAny of rSubSeq )
                    this.InsertHolidayList( rAnyConv, rAny, nNullDate, false/*bInsertOnWeekend*/ );
            }
        }
        else
            this.InsertHolidayList( rAnyConv, rHolAny, nNullDate, false/*bInsertOnWeekend*/ );
    }
}


export class ScaDoubleList
{
    private maVector: number[] = [];

    protected ListAppend( fValue: number ): void { this.maVector.push(fValue); }

    /** Append( double ), Append( sequence< sequence< double > > ) (or of sal_Int32), and
        Append( rAnyConv, xOpt, sequence< any > ). */
    Append( fValue: number ): void;
    Append( rValueArr: readonly (readonly number[])[] ): void;
    Append( rAnyConv: ScaAnyConverter, xOpt: XPropertySet | null | undefined, rAnySeq: readonly UnoAny[] ): void;
    Append( a0: unknown, a1?: unknown, a2?: unknown ): void
    {
        if( typeof a0 === 'number' )
        {
            if( this.CheckInsert( a0 ) ) this.ListAppend( a0 );
            return;
        }
        if( a0 instanceof ScaAnyConverter )
        {
            const rAnyConv = a0, xOpt = a1 as XPropertySet | null | undefined, rAnySeq = a2 as readonly UnoAny[];
            rAnyConv.init( xOpt );
            this.Append_AnySeq( rAnyConv, rAnySeq, true/*bIgnoreEmpty*/ );
            return;
        }
        const rValueSeq = a0 as readonly (readonly number[])[];
        for( const rSubSeq of rValueSeq )
        {
            for( const fValue of rSubSeq )
                this.Append( fValue );
        }
    }

    /** Append( rAnyConv, const css::uno::Any& rAny, bIgnoreEmpty )
        @param rAnyConv  must be an initialized ScaAnyConmverter
        @param bIgnoreEmpty  handling of empty Any's/strings: false = inserted as 0.0; true = omitted */
    protected Append_Any( rAnyConv: ScaAnyConverter, rAny: UnoAny, bIgnoreEmpty: boolean ): void
    {
        if( isAnySeqSeq( rAny ) )
            this.Append_AnySeqSeq( rAnyConv, rAny, bIgnoreEmpty );
        else
        {
            const fValue = { value: 0 };
            if( rAnyConv.getDouble( fValue, rAny ) )
                this.Append( fValue.value );
            else if( !bIgnoreEmpty )
                this.Append( 0.0 );
        }
    }

    /** Append( rAnyConv, const css::uno::Sequence< css::uno::Any >& rAnySeq, bIgnoreEmpty ) */
    protected Append_AnySeq( rAnyConv: ScaAnyConverter, rAnySeq: readonly UnoAny[], bIgnoreEmpty: boolean ): void
    {
        for( const rAny of rAnySeq )
            this.Append_Any( rAnyConv, rAny, bIgnoreEmpty );
    }

    /** Append( rAnyConv, const css::uno::Sequence< css::uno::Sequence< css::uno::Any > >& rAnySeq, bIgnoreEmpty ) */
    protected Append_AnySeqSeq( rAnyConv: ScaAnyConverter, rAnySeq: readonly (readonly UnoAny[])[], bIgnoreEmpty: boolean ): void
    {
        for( const rArray of rAnySeq )
            this.Append_AnySeq( rAnyConv, rArray, bIgnoreEmpty );
    }

    Count(): number { return this.maVector.length; }
    Get( n: number ): number { return this.maVector[n]!; }

    CheckInsert( _fValue: number ): boolean
    {
        return true;
    }
}


/// stores double values >0.0, throws exception for double values <0.0, does nothing for 0.0
export class ScaDoubleListGT0 extends ScaDoubleList
{
    override CheckInsert( fValue: number ): boolean
    {
        if( fValue < 0.0 )
            throw new IllegalArgumentException();
        return fValue > 0.0;
    }
}


/// stores double values >=0.0, throws exception for double values <0.0
export class ScaDoubleListGE0 extends ScaDoubleList
{
    override CheckInsert( fValue: number ): boolean
    {
        if( fValue < 0.0 )
            throw new IllegalArgumentException();
        return true;
    }
}


export class Complex
{
    private num: StdComplex;
    private c: string;

    /** Complex( double fReal, double fImag = 0.0, sal_Unicode cC = '\0' ), or
        Complex( const OUString& rComplexAsString ), or the copy constructor. */
    constructor( fReal: number | string | Complex, fImag = 0.0, cC = '\0' )
    {
        if( fReal instanceof Complex )
        {
            this.num = { ...fReal.num };
            this.c = fReal.c;
            return;
        }
        this.c = cC;
        this.num = cplx( 0, 0 );
        if( typeof fReal === 'string' )
        {
            if( !Complex.ParseString( fReal, this ) )
                throw new IllegalArgumentException();
            return;
        }
        this.num = cplx(fReal, fImag);
    }

    static IsImagUnit( c: string ): boolean
    {
        return c === 'i' || c === 'j';
    }

    static ParseString( rStr: string, rCompl: Complex ): boolean
    {
        rCompl.c = '\0';    // do not force a symbol, if only real part present

        const pStr = new StrCursor( rStr );

        if( Complex.IsImagUnit( pStr.at() ) && rStr.length === 1)
        {
            rCompl.c = pStr.at();
            rCompl.num = cplx(0.0, 1.0);
            return true;
        }

        let f = ParseDouble( pStr );

        if( f === null )
            return false;

        switch( pStr.at() )
        {
            case '-':   // imag part follows
            case '+':
                {
                const r = f;
                if( Complex.IsImagUnit( pStr.at( 1 ) ) )
                {
                    rCompl.c = pStr.at( 1 );
                    if( pStr.at( 2 ) === '\0' )
                    {
                        rCompl.num = cplx(f, ( pStr.at() === '+' )? 1.0 : -1.0);
                        return true;
                    }
                }
                else if( ( f = ParseDouble( pStr ) ) !== null && Complex.IsImagUnit( pStr.at() ) )
                {
                    rCompl.c = pStr.at();
                    pStr.p++;
                    if( pStr.at() === '\0' )
                    {
                        rCompl.num = cplx(r, f);
                        return true;
                    }
                }
                }
                break;
            case 'j':
            case 'i':
                rCompl.c = pStr.at();
                pStr.p++;
                if( pStr.at() === '\0' )
                {
                    rCompl.num = cplx(0.0, f);
                    return true;
                }
                break;
            case '\0':     // only real-part
                rCompl.num = cplx(f, 0.0);
                return true;
        }

        return false;
    }

    GetString(): string
    {
        finiteOrThrow(this.num.re);
        finiteOrThrow(this.num.im);
        let aRet = '';

        const bHasImag = this.num.im !== 0.0;
        const bHasReal = !bHasImag || (this.num.re !== 0.0);

        if( bHasReal )
            aRet += GetString( this.num.re, false );
        if( bHasImag )
        {
            if( this.num.im === 1.0 )
            {
                if( bHasReal )
                    aRet += '+';
            }
            else if( this.num.im === -1.0 )
                aRet += '-';
            else
                aRet += GetString( this.num.im, bHasReal );
            aRet += (this.c !== 'j') ? 'i' : 'j';
        }

        return aRet;
    }

    Real(): number { return this.num.re; }
    Imag(): number { return this.num.im; }

    Arg(): number
    {
        // Note: there are differing opinions on whether arg(0) should be 0 or undefined, we are treating it as undefined
        if( this.num.re === 0.0 && this.num.im === 0.0 )
            throw new IllegalArgumentException();
        return c_arg(this.num);
    }

    Abs(): number { return c_abs(this.num); }

    // following functions change the complex number itself to avoid unnecessary copy actions!
    Power( fPower: number ): void
    {
        if( this.num.re === 0.0 && this.num.im === 0.0 && fPower <= 0 )
            throw new IllegalArgumentException();
        this.num = c_pow(this.num, fPower);
    }

    Sqrt(): void
    {
        this.num = c_sqrt(this.num);
    }

    Sin(): void
    {
        if( !isValidArcArg( this.num.re ) )
            throw new IllegalArgumentException();
        this.num = c_sin(this.num);
    }

    Cos(): void
    {
        if( !isValidArcArg( this.num.re ) )
            throw new IllegalArgumentException();
        this.num = c_cos(this.num);
    }

    Div( z: Complex ): void
    {
        if( z.num.re === 0 && z.num.im === 0 )
            throw new IllegalArgumentException();
        this.num = c_div(this.num, z.num);
    }

    Exp(): void
    {
        this.num = c_exp(this.num);
    }

    Conjugate(): void
    {
        this.num = c_conj(this.num);
    }

    Ln(): void
    {
        this.num = c_log(this.num);
    }

    Log10(): void
    {
        this.num = c_log10(this.num);
    }

    Log2(): void
    {
        this.Ln();
        this.Mult( M_LOG2E );
    }

    /** Mult( double fFact ) or Mult( const Complex& rMult ) */
    Mult( rM: number | Complex ): void
    {
        if( typeof rM === 'number' )
        {
            this.num = cplx(this.num.re * rM, this.num.im * rM);
            return;
        }
        this.num = c_mul(this.num, rM.num);
        if( this.c === '\0' ) this.c = rM.c;
    }

    Sub( rC: Complex ): void
    {
        this.num = cplx(this.num.re - rC.num.re, this.num.im - rC.num.im);
        if( this.c === '\0' ) this.c = rC.c;
    }

    Add( rAdd: Complex ): void
    {
        this.num = cplx(this.num.re + rAdd.num.re, this.num.im + rAdd.num.im);
        if( this.c === '\0' ) this.c = rAdd.c;
    }

    Tan(): void
    {
        // using 2.0 * num.real/imag as a precaution because a) this is what our previous implementation did and
        // b) the std::complex implementation may use cos(2x) etc, see the comment in isValidArcArg for details
        if ( ( this.num.im && !isValidArcArg( 2.0 * this.num.re ) )
            || ( !this.num.im && !isValidArcArg( this.num.re ) ) )
            throw new IllegalArgumentException();
        this.num = c_tan(this.num);
    }

    Sec(): void
    {
        this.Cos();
        this.num = c_inv(this.num);
    }

    Csc(): void
    {
        this.Sin();
        this.num = c_inv(this.num);
    }

    Cot(): void
    {

        this.Tan();
        this.num = c_inv(this.num);
    }

    Sinh(): void
    {
        if( !isValidArcArg( this.num.im ) )
            throw new IllegalArgumentException();
        this.num = c_sinh(this.num);
    }

    Cosh(): void
    {
        if( !isValidArcArg( this.num.im ) )
            throw new IllegalArgumentException();
        this.num = c_cosh(this.num);
    }

    Sech(): void
    {
        this.Cosh();
        this.num = c_inv(this.num);
    }

    Csch(): void
    {
        this.Sinh();
        this.num = c_inv(this.num);
    }
}


export class ComplexList
{
    private maVector: Complex[] = [];

    Get( n: number ): Complex { return this.maVector[n]!; }

    empty(): boolean { return this.maVector.length === 0; }
    Count(): number { return this.maVector.length; }

    /** Append( Complex&& ) */
    Append( p: Complex ): void
    {
        this.maVector.push(p);
    }

    /** Append( const css::uno::Sequence< css::uno::Sequence< OUString > >& ) */
    Append_StrSeqSeq( r: readonly (readonly string[])[] ): void
    {
        for( const rList of r )
        {
            for( const rStr of rList )
            {
                if( rStr )
                    this.Append( new Complex( rStr ) );
            }
        }
    }

    /** Append( const css::uno::Sequence< css::uno::Any >& ) */
    Append_AnySeq( aMultPars: readonly UnoAny[] ): void
    {
        for( const r of aMultPars )
        {
            if( r === undefined || r === null )
                continue;   // TypeClass_VOID
            else if( typeof r === 'string' )
            {
                const pStr = r;

                if( pStr )
                    this.Append( new Complex( pStr ) );
            }
            else if( typeof r === 'number' )
                this.Append( new Complex( r, 0.0 ) );
            else if( Array.isArray( r ) )
            {
                if( !isAnySeqSeq( r ) )
                    throw new IllegalArgumentException();
                const aValArr = r;

                for (const rArr of aValArr)
                    this.Append_AnySeq( rArr );
            }
            else
                throw new IllegalArgumentException();
        }
    }
}


export const ConvertDataClass = {
    CDC_Mass: 0, CDC_Length: 1, CDC_Time: 2, CDC_Pressure: 3, CDC_Force: 4, CDC_Energy: 5, CDC_Power: 6, CDC_Magnetism: 7,
    CDC_Temperature: 8, CDC_Volume: 9, CDC_Area: 10, CDC_Speed: 11, CDC_Information: 12,
} as const;
export type ConvertDataClass = (typeof ConvertDataClass)[keyof typeof ConvertDataClass];
const { CDC_Mass, CDC_Length, CDC_Time, CDC_Pressure, CDC_Force, CDC_Energy, CDC_Power, CDC_Magnetism,
    CDC_Temperature, CDC_Volume, CDC_Area, CDC_Speed, CDC_Information } = ConvertDataClass;


export class ConvertData
{
    protected fConst: number;
    protected aName: string;
    protected eClass: ConvertDataClass;
    protected bPrefixSupport: boolean;

    constructor( sUnitName: string, fC: number, e: ConvertDataClass, bPrefSupport = false )
    {
        this.fConst = fC;
        this.aName = sUnitName;
        this.eClass = e;
        this.bPrefixSupport = bPrefSupport;
    }

    // 0.0 = no equality
    // 1.0 = matches exact
    // rest = matches without an assumed prefix of one character
    //  rest gives power for 10 represented by the prefix (e.g. 3 for k or -9 for n
    GetMatchingLevel( rRef: string ): number
    {
        let aStr = rRef;
        const nIndex = rRef.lastIndexOf('^');
        if (nIndex > 0 && nIndex === (rRef.length - 2))
            aStr = aStr.slice(0, nIndex) + aStr.slice(nIndex + 1);
        if( this.aName === aStr )
            return 0;
        if (this.bPrefixSupport && aStr.endsWith(this.aName))
        {
            const prefix = aStr.slice(0, aStr.length - this.aName.length);
            if (prefix.length === 1 || prefix === "da")
            {
                let n: number;
                switch (prefix[0])
                {
                    case 'y':   n = -24;    break;      // yocto
                    case 'z':   n = -21;    break;      // zepto
                    case 'a':   n = -18;    break;
                    case 'f':   n = -15;    break;
                    case 'p':   n = -12;    break;
                    case 'n':   n = -9;     break;
                    case 'u':   n = -6;     break;
                    case 'm':   n = -3;     break;
                    case 'c':   n = -2;     break;
                    case 'd':
                        if (prefix.length === 1)
                            n = -1;                     // deci
                        else
                            n = 1;                      // deca
                        break;
                    case 'e':   n = 1;      break;
                    case 'h':   n = 2;      break;
                    case 'k':   n = 3;      break;
                    case 'M':   n = 6;      break;
                    case 'G':   n = 9;      break;
                    case 'T':   n = 12;     break;
                    case 'P':   n = 15;     break;
                    case 'E':   n = 18;     break;
                    case 'Z':   n = 21;     break;      // zetta
                    case 'Y':   n = 24;     break;      // yotta
                    default: return INV_MATCHLEV;
                }

// We could weed some nonsense out, ODFF doesn't say so though.
// #if 0
//              if (n < 0 && Class() == CDC_Information)
//                  return INV_MATCHLEV;   // milli-bits doesn't make sense
// #endif

//! <HACK> "cm3" is not 10^-2 m^3 but 10^-6 m^3 !!! ------------------
                if (aStr.endsWith("2"))
                    n *= 2;
                else if (aStr.endsWith("3"))
                    n *= 3;
//! </HACK> -------------------------------------------------------------------

                return n;
            }
            else if (prefix.length === 2 && prefix[1] === 'i' && this.Class() === CDC_Information)
            {
                switch (prefix[0])
                {
                    case 'k': return 10;
                    case 'M': return 20;
                    case 'G': return 30;
                    case 'T': return 40;
                    case 'P': return 50;
                    case 'E': return 60;
                    case 'Z': return 70;
                    case 'Y': return 80;
                    default:  return INV_MATCHLEV;
                }
            }
        }
        return INV_MATCHLEV;
    }

    Convert( f: number, r: ConvertData, nLevFrom: number, nLevTo: number ): number
    {
        f *= r.fConst / this.fConst;

        if (this.Class() === CDC_Information)
        {
            const bBinFromLev = (nLevFrom > 0 && (nLevFrom % 10) === 0);
            const bBinToLev = (nLevTo > 0 && (nLevTo % 10) === 0);
            if (bBinFromLev || bBinToLev)
            {
                if (bBinFromLev && bBinToLev)
                {
                    nLevFrom -= nLevTo;
                    if (nLevFrom)
                        f *= Math.pow(2.0, nLevFrom);
                }
                else if (bBinFromLev)
                    f *= Math.pow(2.0, nLevFrom) / Math.pow(10.0, nLevTo);
                else
                    f *= Math.pow(10.0, nLevFrom) / Math.pow(2.0, nLevTo);
                return f;
            }
        }

        nLevFrom -= nLevTo; // effective level
        if( nLevFrom )
            f = pow10Exp( f, nLevFrom );

        return f;
    }

    Class(): ConvertDataClass { return this.eClass; }
}

export class ConvertDataLinear extends ConvertData
{
    private fOffs: number;

    constructor( sUnitName: string, fC: number, fO: number, e: ConvertDataClass, bPrefSupport = false )
    {
        super( sUnitName, fC, e, bPrefSupport );
        this.fOffs = fO;
    }

    // for cases where f(x) = a + bx applies (e.g. Temperatures)
    override Convert( f: number, r: ConvertData, nLevFrom: number, nLevTo: number ): number
    {
        return (r as ConvertDataLinear).ConvertFromBase( this.ConvertToBase( f, nLevFrom ), nLevTo );
    }

    // converts fVal from this unit to rFrom unit
    // throws exception if not from same class
    // this implementation is for proportional cases only
    ConvertToBase( f: number, n: number ): number
    {
        if( n )
            f = pow10Exp( f, n );

        f /= this.fConst;
        f -= this.fOffs;

        return f;
    }

    ConvertFromBase( f: number, n: number ): number
    {
        f += this.fOffs;
        f *= this.fConst;

        if( n )
            f = pow10Exp( f, -n );

        return f;
    }
}


export class ConvertDataList
{
    private maVector: ConvertData[] = [];

    constructor()
    {
        const NEWD = (str: string, unit: number, cl: ConvertDataClass) => { this.maVector.push(new ConvertData(str, unit, cl)); };
        const NEWDP = (str: string, unit: number, cl: ConvertDataClass) => { this.maVector.push(new ConvertData(str, unit, cl, true)); };
        const NEWL = (str: string, unit: number, offs: number, cl: ConvertDataClass) => { this.maVector.push(new ConvertDataLinear(str, unit, offs, cl)); };
        const NEWLP = (str: string, unit: number, offs: number, cl: ConvertDataClass) => { this.maVector.push(new ConvertDataLinear(str, unit, offs, cl, true)); };

        // *** are extra and not standard Excel Analysis Addin!

        // MASS: 1 Gram is...
        NEWDP( "g",         1.0000000000000000E00,  CDC_Mass ); // Gram
        NEWD( "sg",         6.8522050005347800E-05, CDC_Mass ); // Pieces
        NEWD( "lbm",        2.2046229146913400E-03, CDC_Mass ); // Pound (commercial weight)
        NEWDP( "u",         6.0221370000000000E23,  CDC_Mass ); // U (atomic mass)
        NEWD( "ozm",        3.5273971800362700E-02, CDC_Mass ); // Ounce (commercial weight)
        NEWD( "stone",      1.574730e-04,           CDC_Mass ); // *** Stone
        NEWD( "ton",        1.102311e-06,           CDC_Mass ); // *** Ton
        NEWD( "grain",      1.543236E01,            CDC_Mass ); // *** Grain
        NEWD( "pweight",    7.054792E-01,           CDC_Mass ); // *** Pennyweight
        NEWD( "hweight",    1.968413E-05,           CDC_Mass ); // *** Hundredweight
        NEWD( "shweight",   2.204623E-05,           CDC_Mass ); // *** Shorthundredweight
        NEWD( "brton",      9.842065E-07,           CDC_Mass ); // *** Gross Registered Ton
        NEWD( "cwt",        2.2046226218487758E-05, CDC_Mass ); // U.S. (short) hundredweight
        NEWD( "shweight",   2.2046226218487758E-05, CDC_Mass ); // U.S. (short) hundredweight also
        NEWD( "uk_cwt",     1.9684130552221213E-05, CDC_Mass ); // Imperial hundredweight
        NEWD( "lcwt",       1.9684130552221213E-05, CDC_Mass ); // Imperial hundredweight also
        NEWD( "hweight",    1.9684130552221213E-05, CDC_Mass ); // Imperial hundredweight also
        NEWD( "uk_ton",     9.8420652761106063E-07, CDC_Mass ); // Imperial ton
        NEWD( "LTON",       9.8420652761106063E-07, CDC_Mass ); // Imperial ton also

        // LENGTH: 1 Meter is...
        NEWDP( "m",         1.0000000000000000E00,  CDC_Length ); // Meter
        NEWD( "mi",         6.2137119223733397E-04, CDC_Length ); // Britsh Mile        6,21371192237333969617434184363e-4
        NEWD( "Nmi",        5.3995680345572354E-04, CDC_Length ); // Nautical Mile      5,39956803455723542116630669546e-4
        NEWD( "in",         3.9370078740157480E01,  CDC_Length ); // Inch               39,37007874015748031496062992126
        NEWD( "ft",         3.2808398950131234E00,  CDC_Length ); // Foot               3,2808398950131233595800524934383
        NEWD( "yd",         1.0936132983377078E00,  CDC_Length ); // Yard               1,0936132983377077865266841644794
        NEWDP( "ang",       1.0000000000000000E10,  CDC_Length ); // Angstrom
        NEWD( "Pica",       2.8346456692913386E03,  CDC_Length ); // Pica Point (1/72 Inch)   2834,6456692913385826771653543307
        NEWD( "picapt",     2.8346456692913386E03,  CDC_Length ); // Pica Point (1/72 Inch)   2834,6456692913385826771653543307
        NEWD( "pica",       2.36220472441E02,       CDC_Length ); // pica (1/6 Inch)
        NEWD( "ell",        8.748906E-01,           CDC_Length ); // *** Ell
        NEWDP( "parsec",    3.240779E-17,           CDC_Length ); // *** Parsec
        NEWDP( "pc",        3.240779E-17,           CDC_Length ); // *** Parsec also
        NEWDP( "lightyear", 1.0570234557732930E-16, CDC_Length ); // *** Light Year
        NEWDP( "ly",        1.0570234557732930E-16, CDC_Length ); // *** Light Year also
        NEWD( "survey_mi",  6.2136994949494949E-04, CDC_Length ); // U.S. survey mile

        // TIME: 1 Second is...
        NEWD( "yr",     3.1688087814028950E-08, CDC_Time ); // Year
        NEWD( "day",    1.1574074074074074E-05, CDC_Time ); // Day
        NEWD( "d",      1.1574074074074074E-05, CDC_Time ); // Day also
        NEWD( "hr",     2.7777777777777778E-04, CDC_Time ); // Hour
        NEWD( "mn",     1.6666666666666667E-02, CDC_Time ); // Minute
        NEWD( "min",    1.6666666666666667E-02, CDC_Time ); // Minute also
        NEWDP( "sec",   1.0000000000000000E00,  CDC_Time ); // Second
        NEWDP( "s",     1.0000000000000000E00,  CDC_Time ); // Second also

        // PRESSURE: 1 Pascal is...
        NEWDP( "Pa",    1.0000000000000000E00,  CDC_Pressure ); // Pascal
        NEWDP( "atm",   9.8692329999819300E-06, CDC_Pressure ); // Atmosphere
        NEWDP( "at",    9.8692329999819300E-06, CDC_Pressure ); // Atmosphere also
        NEWDP( "mmHg",  7.5006170799862700E-03, CDC_Pressure ); // mm Hg (Mercury)
        NEWD( "Torr",   7.5006380000000000E-03, CDC_Pressure ); // *** Torr
        NEWD( "psi",    1.4503770000000000E-04, CDC_Pressure ); // *** Psi

        // FORCE: 1 Newton is...
        NEWDP( "N",     1.0000000000000000E00,  CDC_Force ); // Newton
        NEWDP( "dyn",   1.0000000000000000E05,  CDC_Force ); // Dyn
        NEWDP( "dy",    1.0000000000000000E05,  CDC_Force ); // Dyn also
        NEWD( "lbf",    2.24808923655339E-01,   CDC_Force ); // Pound-Force
        NEWDP( "pond",  1.019716E02,            CDC_Force ); // *** Pond

        // ENERGY: 1 Joule is...
        NEWDP( "J",     1.0000000000000000E00,  CDC_Energy ); // Joule
        NEWDP( "e",     1.0000000000000000E07,  CDC_Energy ); // Erg  -> https://en.wikipedia.org/wiki/Erg
        NEWDP( "c",     2.3900624947346700E-01, CDC_Energy ); // Thermodynamical Calorie
        NEWDP( "cal",   2.3884619064201700E-01, CDC_Energy ); // Calorie
        NEWDP( "eV",    6.2414570000000000E18,  CDC_Energy ); // Electronvolt
        NEWDP( "ev",    6.2414570000000000E18,  CDC_Energy ); // Electronvolt also
        NEWD( "HPh",    3.7250611111111111E-07, CDC_Energy ); // Horsepower Hours
        NEWD( "hh",     3.7250611111111111E-07, CDC_Energy ); // Horsepower Hours also
        NEWDP( "Wh",    2.7777777777777778E-04, CDC_Energy ); // Watt Hours
        NEWDP( "wh",    2.7777777777777778E-04, CDC_Energy ); // Watt Hours also
        NEWD( "flb",    2.37304222192651E01,    CDC_Energy ); // Foot Pound
        NEWD( "BTU",    9.4781506734901500E-04, CDC_Energy ); // British Thermal Unit
        NEWD( "btu",    9.4781506734901500E-04, CDC_Energy ); // British Thermal Unit also

        // POWER: 1 Watt is...
        NEWDP( "W",     1.0000000000000000E00,  CDC_Power ); // Watt
        NEWDP( "w",     1.0000000000000000E00,  CDC_Power ); // Watt also
        NEWD( "HP",     1.341022E-03,           CDC_Power ); // Horsepower
        NEWD( "h",      1.341022E-03,           CDC_Power ); // Horsepower also
        NEWD( "PS",     1.359622E-03,           CDC_Power ); // *** German Pferdestaerke

        // MAGNETISM: 1 Tesla is...
        NEWDP( "T",     1.0000000000000000E00,  CDC_Magnetism ); // Tesla
        NEWDP( "ga",    1.0000000000000000E04,  CDC_Magnetism ); // Gauss

        // TEMPERATURE: 1 Kelvin is...
        NEWL( "C",      1.0000000000000000E00,  -2.7315000000000000E02, CDC_Temperature ); // Celsius
        NEWL( "cel",    1.0000000000000000E00,  -2.7315000000000000E02, CDC_Temperature ); // Celsius also
        NEWL( "F",      1.8000000000000000E00,  -2.5537222222222222E02, CDC_Temperature ); // Fahrenheit
        NEWL( "fah",    1.8000000000000000E00,  -2.5537222222222222E02, CDC_Temperature ); // Fahrenheit also
        NEWLP( "K",     1.0000000000000000E00,  +0.0000000000000000E00, CDC_Temperature ); // Kelvin
        NEWLP( "kel",   1.0000000000000000E00,  +0.0000000000000000E00, CDC_Temperature ); // Kelvin also
        NEWL( "Reau",   8.0000000000000000E-01, -2.7315000000000000E02, CDC_Temperature ); // *** Reaumur
        NEWL( "Rank",   1.8000000000000000E00,  +0.0000000000000000E00, CDC_Temperature ); // *** Rankine

        // VOLUME: 1 Liter is...
        NEWD( "tsp",        2.0288413621105798E02,  CDC_Volume ); // US teaspoon            1/768 gallon
        NEWD( "tbs",        6.7628045403685994E01,  CDC_Volume ); // US tablespoon          1/256 gallon
        NEWD( "oz",         3.3814022701842997E01,  CDC_Volume ); // Ounce Liquid           1/128 gallon
        NEWD( "cup",        4.2267528377303746E00,  CDC_Volume ); // Cup                    1/16 gallon
        NEWD( "pt",         2.1133764188651873E00,  CDC_Volume ); // US Pint                1/8 gallon
        NEWD( "us_pt",      2.1133764188651873E00,  CDC_Volume ); // US Pint also
        NEWD( "uk_pt",      1.7597539863927023E00,  CDC_Volume ); // UK Pint                1/8 imperial gallon
        NEWD( "qt",         1.0566882094325937E00,  CDC_Volume ); // Quart                  1/4 gallon
        NEWD( "gal",        2.6417205235814842E-01, CDC_Volume ); // Gallon                 1/3.785411784
        NEWDP( "l",         1.0000000000000000E00,  CDC_Volume ); // Liter
        NEWDP( "L",         1.0000000000000000E00,  CDC_Volume ); // Liter also
        NEWDP( "lt",        1.0000000000000000E00,  CDC_Volume ); // Liter also
        NEWDP( "m3",        1.0000000000000000E-03, CDC_Volume ); // *** Cubic Meter
        NEWD( "mi3",        2.3991275857892772E-13, CDC_Volume ); // *** Cubic Britsh Mile
        NEWD( "Nmi3",       1.5742621468581148E-13, CDC_Volume ); // *** Cubic Nautical Mile
        NEWD( "in3",        6.1023744094732284E01,  CDC_Volume ); // *** Cubic Inch
        NEWD( "ft3",        3.5314666721488590E-02, CDC_Volume ); // *** Cubic Foot
        NEWD( "yd3",        1.3079506193143922E-03, CDC_Volume ); // *** Cubic Yard
        NEWDP( "ang3",      1.0000000000000000E27,  CDC_Volume ); // *** Cubic Angstrom
        NEWD( "Pica3",      2.2776990435870636E07,  CDC_Volume ); // *** Cubic Pica Point (1/72 inch)
        NEWD( "picapt3",    2.2776990435870636E07,  CDC_Volume ); // *** Cubic Pica Point (1/72 inch)
        NEWD( "pica3",      1.31811287245E04,       CDC_Volume ); // *** Cubic Pica (1/6 inch)
        NEWD( "barrel",     6.2898107704321051E-03, CDC_Volume ); // *** Barrel (=42gal)
        NEWD( "bushel",     2.837759E-02,           CDC_Volume ); // *** Bushel
        NEWD( "regton",     3.531467E-04,           CDC_Volume ); // *** Register ton
        NEWD( "GRT",        3.531467E-04,           CDC_Volume ); // *** Register ton also
        NEWD( "Schooner",   2.3529411764705882E00,  CDC_Volume ); // *** austr. Schooner
        NEWD( "Middy",      3.5087719298245614E00,  CDC_Volume ); // *** austr. Middy
        NEWD( "Glass",      5.0000000000000000E00,  CDC_Volume ); // *** austr. Glass
        NEWD( "Sixpack",    0.5,                    CDC_Volume ); // ***
        NEWD( "Humpen",     2.0,                    CDC_Volume ); // ***
        NEWD( "ly3",        1.1810108125623799E-51, CDC_Volume ); // *** Cubic light-year
        NEWD( "MTON",       1.4125866688595436E00,  CDC_Volume ); // *** Measurement ton
        NEWD( "tspm",       2.0000000000000000E02,  CDC_Volume ); // *** Modern teaspoon
        NEWD( "uk_gal",     2.1996924829908779E-01,  CDC_Volume ); // U.K. / Imperial gallon        1/4.54609
        NEWD( "uk_qt",      8.7987699319635115E-01,  CDC_Volume ); // U.K. / Imperial quart         1/4 imperial gallon

        // 1 Square Meter is...
        NEWDP( "m2",        1.0000000000000000E00,  CDC_Area ); // *** Square Meter
        NEWD( "mi2",        3.8610215854244585E-07, CDC_Area ); // *** Square Britsh Mile
        NEWD( "Nmi2",       2.9155334959812286E-07, CDC_Area ); // *** Square Nautical Mile
        NEWD( "in2",        1.5500031000062000E03,  CDC_Area ); // *** Square Inch
        NEWD( "ft2",        1.0763910416709722E01,  CDC_Area ); // *** Square Foot
        NEWD( "yd2",        1.1959900463010803E00,  CDC_Area ); // *** Square Yard
        NEWDP( "ang2",      1.0000000000000000E20,  CDC_Area ); // *** Square Angstrom
        NEWD( "Pica2",      8.0352160704321409E06,  CDC_Area ); // *** Square Pica Point (1/72 inch)
        NEWD( "picapt2",    8.0352160704321409E06,  CDC_Area ); // *** Square Pica Point (1/72 inch)
        NEWD( "pica2",      5.58001116002232E04,    CDC_Area ); // *** Square Pica (1/6 inch)
        NEWD( "Morgen",     4.0000000000000000E-04, CDC_Area ); // *** Morgen
        NEWDP( "ar",        1.000000E-02,           CDC_Area ); // *** Ar
        NEWD( "acre",       2.471053815E-04,        CDC_Area ); // *** Acre
        NEWD( "uk_acre",    2.4710538146716534E-04, CDC_Area ); // *** International acre
        NEWD( "us_acre",    2.4710439304662790E-04, CDC_Area ); // *** U.S. survey/statute acre
        NEWD( "ly2",        1.1172985860549147E-32, CDC_Area ); // *** Square Light-year
        NEWD( "ha",         1.000000E-04,           CDC_Area ); // *** Hectare

        // SPEED: 1 Meter per Second is...
        NEWDP( "m/s",   1.0000000000000000E00,  CDC_Speed ); // *** Meters per Second
        NEWDP( "m/sec", 1.0000000000000000E00,  CDC_Speed ); // *** Meters per Second also
        NEWDP( "m/h",   3.6000000000000000E03,  CDC_Speed ); // *** Meters per Hour
        NEWDP( "m/hr",  3.6000000000000000E03,  CDC_Speed ); // *** Meters per Hour also
        NEWD( "mph",    2.2369362920544023E00,  CDC_Speed ); // *** Britsh Miles per Hour
        NEWD( "kn",     1.9438444924406048E00,  CDC_Speed ); // *** Knot = Nautical Miles per Hour
        NEWD( "admkn",  1.9438446603753486E00,  CDC_Speed ); // *** Admiralty Knot
        NEWD( "ludicrous speed", 2.0494886343432328E-14, CDC_Speed ); // ***
        NEWD( "ridiculous speed", 4.0156958471424288E-06, CDC_Speed); // ***

        // INFORMATION: 1 Bit is...
        NEWDP( "bit",   1.00E00,  CDC_Information); // *** Bit
        NEWDP( "byte",  1.25E-01, CDC_Information); // *** Byte
    }

    Convert( fVal: number, rFrom: string, rTo: string ): number
    {
        let pFrom: ConvertData | null = null;
        let pTo: ConvertData | null = null;
        let bSearchFrom = true;
        let bSearchTo = true;
        let nLevelFrom = 0;
        let nLevelTo = 0;

        for( const rItem of this.maVector )
        {
            if( bSearchFrom )
            {
                const n = rItem.GetMatchingLevel(rFrom);
                if( n !== INV_MATCHLEV )
                {
                    pFrom = rItem;
                    nLevelFrom = n;
                    if (!n)
                    {   // only first match for partial equality rulz a little bit more
                        // ... but exact match rulz most
                        bSearchFrom = false;
                    }
                }
            }

            if( bSearchTo )
            {
                const n = rItem.GetMatchingLevel(rTo);
                if( n !== INV_MATCHLEV )
                {
                    pTo = rItem;
                    nLevelTo = n;
                    if (!n)
                    {   // only first match for partial equality rulz a little bit more
                        // ... but exact match rulz most
                        bSearchTo = false;
                    }
                }
            }

            if( !bSearchFrom && !bSearchTo )
                break;
        }

        if( !pFrom || !pTo )
            throw new IllegalArgumentException();

        if (pFrom.Class() !== pTo.Class())
            throw new IllegalArgumentException();

        return pFrom.Convert( fVal, pTo, nLevelFrom, nLevelTo );
    }
}


/// Helper class for date calculation for various financial functions
export class ScaDate
{
    private nOrigDay = 1;           /// is the day of the original date.
    private nDay = 1;               /// is the calculated day depending on the current month/year.
    private nMonth = 1;             /// is the current month (one-based).
    private nYear = 1900;           /// is the current year.
    private bLastDayMode = true;    /// if true, recalculate nDay after every calculation.
    private bLastDay = false;       /// is true, if original date was the last day in month.
    private b30Days = false;        /// is true, if every month has 30 days in calculations.
    private bUSMode = false;        /// is true, if the US method of 30-day-calculations is used.

    /** ScaDate(), the copy constructor, or ScaDate( nNullDate, nDate, nBase ) with
        @param nBase
            date handling mode (days in month / days in year):
            0 = 30 days / 360 days (US NASD)
            1 = exact / exact
            2 = exact / 360
            3 = exact / 365
            4 = 30 days / 360 days (Europe)
            5 = exact / exact (no last day adjustment) */
    constructor( nNullDate?: number | ScaDate, nDate?: number, nBase?: number )
    {
        if( nNullDate instanceof ScaDate )
        {
            this.assign( nNullDate );
            return;
        }
        if( nNullDate === undefined )
            return;
        [ this.nOrigDay, this.nMonth, this.nYear ] = DaysToDate( nNullDate + nDate! );
        this.bLastDayMode = (nBase !== 5);
        this.bLastDay = (this.nOrigDay >= DaysInMonth( this.nMonth, this.nYear ));
        this.b30Days = (nBase === 0) || (nBase === 4);
        this.bUSMode = (nBase === 0);
        this.setDay();
    }

    /** operator= */
    assign( rCopy: ScaDate ): this
    {
        if( this !== rCopy )
        {
            this.nOrigDay = rCopy.nOrigDay;
            this.nDay = rCopy.nDay;
            this.nMonth = rCopy.nMonth;
            this.nYear = rCopy.nYear;
            this.bLastDayMode = rCopy.bLastDayMode;
            this.bLastDay = rCopy.bLastDay;
            this.b30Days = rCopy.b30Days;
            this.bUSMode = rCopy.bUSMode;
        }
        return this;
    }

    /// Calculates nDay from nOrigDay and current date.
    private setDay(): void
    {
        if( this.b30Days )
        {
            // 30-days-mode: set nDay to 30 if original was last day in month
            this.nDay = Math.min( this.nOrigDay, 30 );
            if( this.bLastDay || (this.nDay >= DaysInMonth( this.nMonth, this.nYear )) )
                this.nDay = 30;
        }
        else
        {
            // set nDay to last day in this month if original was last day
            const nLastDay = DaysInMonth( this.nMonth, this.nYear );
            this.nDay = this.bLastDay ? nLastDay : Math.min( this.nOrigDay, nLastDay );
        }
    }

    /// @return  count of days in current month, or in the given month
    private getDaysInMonth( _nMon = this.nMonth ): number
    {
        return this.b30Days ? 30 : DaysInMonth( _nMon, this.nYear );
    }

    /// @ return  count of days in the given month range
    private getDaysInMonthRange( nFrom: number, nTo: number ): number
    {
        if( nFrom > nTo )
            return 0;

        let nRet = 0;
        if( this.b30Days )
            nRet = (nTo - nFrom + 1) * 30;
        else
        {
            for( let nMonthIx = nFrom; nMonthIx <= nTo; ++nMonthIx )
                nRet += this.getDaysInMonth( nMonthIx );
        }
        return nRet;
    }

    /// @ return  count of days in the given year range
    private getDaysInYearRange( nFrom: number, nTo: number ): number
    {
        if( nFrom > nTo )
            return 0;

        return this.b30Days ? ((nTo - nFrom + 1) * 360) : GetDaysInYears( nFrom, nTo );
    }

    /// Adds/subtracts the given count of years, does not adjust day.
    private doAddYears( nYearCount: number ): void
    {
        const nNewYear = nYearCount + this.nYear;
        if( (nNewYear < 0) || (nNewYear > 0x7FFF) )
            throw new IllegalArgumentException();
        this.nYear = nNewYear;
    }

    /// @return  the current month.
    getMonth(): number { return this.nMonth; }
    /// @return  the current year.
    getYear(): number { return this.nYear; }

    /// adds/subtracts the given count of months, adjusts day
    addMonths( nMonthCount: number ): void
    {
        let nNewMonth = nMonthCount + this.nMonth;
        if( nNewMonth > 12 )
        {
            --nNewMonth;
            this.doAddYears( idiv( nNewMonth, 12 ) );
            this.nMonth = ( nNewMonth % 12 ) + 1;
        }
        else if( nNewMonth < 1 )
        {
            this.doAddYears( idiv( nNewMonth, 12 ) - 1 );
            this.nMonth = nNewMonth % 12 + 12;
        }
        else
            this.nMonth = nNewMonth;
        this.setDay();
    }

    /// sets the given year, adjusts day
    setYear( nNewYear: number ): void
    {
        this.nYear = nNewYear;
        this.setDay();
    }

    /// adds/subtracts the given count of years, adjusts day
    addYears( nYearCount: number ): void
    {
        this.doAddYears( nYearCount );
        this.setDay();
    }

    /// @return  the internal number of the current date
    getDate( nNullDate: number ): number
    {
        const nLastDay = DaysInMonth( this.nMonth, this.nYear );
        const nRealDay = (this.bLastDayMode && this.bLastDay) ? nLastDay : Math.min( nLastDay, this.nOrigDay );
        return DateToDays( nRealDay, this.nMonth, this.nYear ) - nNullDate;
    }

    /// @return  the number of days between the two dates
    static getDiff( rFrom: ScaDate, rTo: ScaDate ): number
    {
        if( rFrom.gt( rTo ) )
            return ScaDate.getDiff( rTo, rFrom );

        let nDiff = 0;
        const aFrom = new ScaDate( rFrom );
        const aTo = new ScaDate( rTo );

        if( rTo.b30Days )
        {
            // corrections for base 0 (US NASD)
            if( rTo.bUSMode )
            {
                if( ((rFrom.nMonth === 2) || (rFrom.nDay < 30)) && (aTo.nOrigDay === 31) )
                    aTo.nDay = 31;
                else if( (aTo.nMonth === 2) && aTo.bLastDay )
                    aTo.nDay = DaysInMonth( 2, aTo.nYear );
            }
            // corrections for base 4 (Europe)
            else
            {
                if( (aFrom.nMonth === 2) && (aFrom.nDay === 30) )
                    aFrom.nDay = DaysInMonth( 2, aFrom.nYear );
                if( (aTo.nMonth === 2) && (aTo.nDay === 30) )
                    aTo.nDay = DaysInMonth( 2, aTo.nYear );
            }
        }

        if( (aFrom.nYear < aTo.nYear) || ((aFrom.nYear === aTo.nYear) && (aFrom.nMonth < aTo.nMonth)) )
        {
            // move aFrom to 1st day of next month
            nDiff = aFrom.getDaysInMonth() - aFrom.nDay + 1;
            aFrom.nOrigDay = aFrom.nDay = 1;
            aFrom.bLastDay = false;
            aFrom.addMonths( 1 );

            if( aFrom.nYear < aTo.nYear )
            {
                // move aFrom to 1st day of next year
                nDiff += aFrom.getDaysInMonthRange( aFrom.nMonth, 12 );
                aFrom.addMonths( 13 - aFrom.nMonth );

                // move aFrom to 1st day of this year
                nDiff += aFrom.getDaysInYearRange( aFrom.nYear, aTo.nYear - 1 );
                aFrom.addYears( aTo.nYear - aFrom.nYear );
            }

            // move aFrom to 1st day of this month
            nDiff += aFrom.getDaysInMonthRange( aFrom.nMonth, aTo.nMonth - 1 );
            aFrom.addMonths( aTo.nMonth - aFrom.nMonth );
        }
        // finally add remaining days in this month
        nDiff += aTo.nDay - aFrom.nDay;
        return Math.max(nDiff, 0);
    }

    /** operator< */
    lt( rCmp: ScaDate ): boolean
    {
        if( this.nYear !== rCmp.nYear )
            return this.nYear < rCmp.nYear;
        if( this.nMonth !== rCmp.nMonth )
            return this.nMonth < rCmp.nMonth;
        if( this.nDay !== rCmp.nDay )
            return this.nDay < rCmp.nDay;
        if( this.bLastDay || rCmp.bLastDay )
            return !this.bLastDay && rCmp.bLastDay;
        return this.nOrigDay < rCmp.nOrigDay;
    }
    /** operator<= */
    le( rCmp: ScaDate ): boolean { return !rCmp.lt( this ); }
    /** operator> */
    gt( rCmp: ScaDate ): boolean { return rCmp.lt( this ); }
    /** operator>= */
    ge( rCmp: ScaDate ): boolean { return !this.lt( rCmp ); }
}


/// Helper class for Any->double conversion, using the current locale
export class ScaAnyConverter
{
    private nDefaultFormat = 'General';
    private bHasValidFormat = false;

    /// Initializing with the current locale
    init( xPropSet: XPropertySet | null | undefined ): void
    {
        // try to get default number format
        this.bHasValidFormat = false;

        // get XFormatsSupplier from outer XPropertySet
        if( !xPropSet )
            return;

        // the port's number formatter: the standard format of en-US
        this.nDefaultFormat = 'General';
        this.bHasValidFormat = true;
    }

    /** Converts a string to double using the number formatter. If the formatter is not
        valid, ::rtl::math::stringToDouble() with english separators will be used.
        @throws css::lang::IllegalArgumentException
            on strings not representing any double value.
        @return  the converted double value. */
    private convertToDouble( rString: string ): number
    {
        let fValue = 0.0;
        if( this.bHasValidFormat )
        {
            const r = IsNumberFormat( rString, 'en-US', this.nDefaultFormat );
            if( !r )
                throw new IllegalArgumentException();
            fValue = r.value;
        }
        else
        {
            const r = stringToDouble( rString, '.', ',' );
            fValue = r.fVal;
            if( (r.eStatus !== rtl_math_ConversionStatus.Ok) || (r.nParseEnd < rString.length) )
                throw new IllegalArgumentException();
        }
        return fValue;
    }

    /** getDouble( rfResult, rAny ): without initialization.
        getDouble( rfResult, xPropSet, rAny ): with initialization.
        The Any can be empty or contain a double or string.
        @throws css::lang::IllegalArgumentException
            on other Any types or on invalid strings.
        @return  true if the Any contains a double or a non-empty valid string,
                 false if the Any is empty or the string is empty
        getDouble( xPropSet, rAny, fDefault ): with initialization,
        @return  the value of the double or string or fDefault if the Any or string is empty */
    getDouble( rfResult: { value: number }, rAny: UnoAny ): boolean;
    getDouble( rfResult: { value: number }, xPropSet: XPropertySet | null | undefined, rAny: UnoAny ): boolean;
    getDouble( xPropSet: XPropertySet | null | undefined, rAny: UnoAny, fDefault: number ): number;
    getDouble( a0: unknown, a1: unknown, a2?: unknown ): boolean | number
    {
        if( arguments.length === 2 )
        {
            const rfResult = a0 as { value: number }, rAny = a1 as UnoAny;
            rfResult.value = 0.0;
            let bContainsVal = true;
            if( rAny === undefined || rAny === null )        // TypeClass_VOID
                bContainsVal = false;
            else if( typeof rAny === 'string' )               // TypeClass_STRING
            {
                const pString = rAny;
                if( pString )
                    rfResult.value = this.convertToDouble( pString );
                else
                    bContainsVal = false;
            }
            else if( typeof rAny === 'number' )
                rfResult.value = rAny;
            else
                throw new IllegalArgumentException();

            return bContainsVal;
        }
        if( typeof a2 === 'number' && !isRef( a0 ) )
        {
            const xPropSet = a0 as XPropertySet | null | undefined, rAny = a1 as UnoAny, fDefault = a2;
            const fResult = { value: 0 };
            if( !this.getDouble( fResult, xPropSet, rAny ) )
                fResult.value = fDefault;
            return fResult.value;
        }
        const rfResult = a0 as { value: number }, xPropSet = a1 as XPropertySet | null | undefined, rAny = a2 as UnoAny;
        this.init( xPropSet );
        return this.getDouble( rfResult, rAny );
    }

    /** getInt32( rnResult, xPropSet, rAny ): with initialization.
        The Any can be empty or contain a double or string.
        @throws css::lang::IllegalArgumentException
            on other Any types or on invalid values or strings.
        @return  true if the Any contains a double or a non-empty valid string,
                 false if the Any is empty or the string is empty
        getInt32( xPropSet, rAny, nDefault ):
        @return  the truncated value of the double or string or nDefault if the Any or string is empty */
    getInt32( rnResult: { value: number }, xPropSet: XPropertySet | null | undefined, rAny: UnoAny ): boolean;
    getInt32( xPropSet: XPropertySet | null | undefined, rAny: UnoAny, nDefault: number ): number;
    getInt32( a0: unknown, a1: unknown, a2: unknown ): boolean | number
    {
        if( typeof a2 === 'number' && !isRef( a0 ) )
        {
            const xPropSet = a0 as XPropertySet | null | undefined, rAny = a1 as UnoAny, nDefault = a2;
            const nResult = { value: 0 };
            if( !this.getInt32( nResult, xPropSet, rAny ) )
                nResult.value = nDefault;
            return nResult.value;
        }
        const rnResult = a0 as { value: number }, xPropSet = a1 as XPropertySet | null | undefined, rAny = a2 as UnoAny;
        const fResult = { value: 0 };
        const bContainsVal = this.getDouble( fResult, xPropSet, rAny );
        if( (fResult.value <= -2147483649.0) || (fResult.value >= 2147483648.0) )
            throw new IllegalArgumentException();

        rnResult.value = Math.trunc( fResult.value );
        return bContainsVal;
    }
}

function isRef( a: unknown ): a is { value: number }
{
    return typeof a === 'object' && a !== null && 'value' in a && !( 'getPropertyValue' in a );
}
