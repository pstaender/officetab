// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/source/analysis/analysis.cxx faithful
// @upstream scaddins/source/analysis/analysis.hxx faithful
// @upstream scaddins/source/analysis/financial.cxx faithful
// The Analysis add-in (com.sun.star.sheet.addin.Analysis): the functions of Excel's Analysis
// ToolPak (EDATE, WORKDAY, YEARFRAC, the base conversions, the complex numbers, CONVERT, the
// bond and coupon functions, ...). financial.cxx implements more methods of the same class; they
// are in the second half of the class, in upstream's order.
// Port notes: no UNO. The class implements the port's ScAddInComponent: getMethods() gives the
// methods of XAnalysis (the IDL's table) with an invoke() that calls the method of the same name,
// in place of UNO introspection. Resources are the en-US strings (AnalysisResId returns the
// string; Translate and the resource locale are left out). RANDBETWEEN uses Math.random() in place
// of comphelper::rng. getDisplayFunctionName and the other XAddIn methods initialise the function
// data themselves when setLocale was not called first.

import { IllegalArgumentException, RuntimeException, ScAddInArgumentType, type LocalizedName, type ScAddInParamInfo, type ScAddInComponent, type ScAddInMethod, type UnoAny, type UnoLocale, type XPropertySet } from '../../../sc/inc/addincol.ts';
import { approxCeil, approxFloor, approxValue, round as rtl_math_round, rtl_math_RoundingMode } from '../../../sal/rtl/math.ts';
import { XAnalysis } from '../../idl/com/sun/star/sheet/addin/XAnalysis.ts';
import {
    BinomialCoefficient, Complex, ComplexList, ConvertDataList, ConvertFromDec, ConvertToDec, DateToDays, DaysInMonth, DaysToDate, Erf, Erfc,
    FDCategory, FindFuncData, GetAmordegrc, GetAmorlinc, GetCoupdaybs, GetCoupdays, GetCoupdaysnc, GetCoupncd, GetCoupnum, GetCouppcd,
    GetDayOfWeek, GetDiffDate360, GetDuration, GetFv, GetGcd, GetNullDate, GetOddfprice, GetOddfyield, GetOddlprice, GetOddlyield, GetPmt,
    GetYearDiff, GetYearFrac, GetYieldmat, InitFuncDataList, ScaAnyConverter, ScaDate, ScaDoubleList, ScaDoubleListGE0, ScaDoubleListGT0,
    SortedIndividualInt32List, finiteOrThrow, getPrice_, getYield_, isFreqInvalid, type FuncData, type FuncDataList,
} from './analysishelper.ts';
import { BesselI, BesselJ, BesselK, BesselY } from './bessel.ts';

const ADDIN_SERVICE = "com.sun.star.sheet.AddIn";
const MY_SERVICE = "com.sun.star.sheet.addin.Analysis";
const MY_IMPLNAME = "com.sun.star.sheet.addin.AnalysisImpl";

type XOpt = XPropertySet | null | undefined;
type Seq2<T> = readonly (readonly T[])[];

const MAXFACTDOUBLE = 300;

const pDefCatName = "Add-In";

const pLang = [ "de", "en" ];
const pCoun = [ "DE", "US" ];
const nNumOfLoc = pLang.length;

const SCA_MAX2        = 511.0;            // min. val for binary numbers (9 bits + sign)
const SCA_MIN2        = -SCA_MAX2-1.0;    // min. val for binary numbers (9 bits + sign)
const SCA_MAX8        = 536870911.0;      // max. val for octal numbers (29 bits + sign)
const SCA_MIN8        = -SCA_MAX8-1.0;    // min. val for octal numbers (29 bits + sign)
const SCA_MAX16       = 549755813887.0;   // max. val for hexadecimal numbers (39 bits + sign)
const SCA_MIN16       = -SCA_MAX16-1.0;   // min. val for hexadecimal numbers (39 bits + sign)
const SCA_MAXPLACES   = 10;               // max. number of places

/** std::nextafter( x, -DBL_MAX ) */
function nextDown( x: number ): number
{
    if( !Number.isFinite( x ) ) return x;
    if( x === 0 ) return -Number.MIN_VALUE;
    const aBuf = new DataView( new ArrayBuffer( 8 ) );
    aBuf.setFloat64( 0, x );
    const nBits = aBuf.getBigUint64( 0 );
    aBuf.setBigUint64( 0, x > 0 ? nBits - 1n : nBits + 1n );
    return aBuf.getFloat64( 0 );
}

/** C's modf: the fractional part, and the integral part in rInt. */
function modf( f: number, rInt: { value: number } ): number
{
    rInt.value = Math.trunc( f );
    return f - rInt.value;
}

/** core reflection's argument conversion in XIdlMethod::invoke: a void Any (an omitted argument)
    cannot become a long, double, string or sequence, which is an IllegalArgumentException. */
function lcl_CheckArgs( aParams: readonly ScAddInParamInfo[], aArgs: unknown[] ): unknown[]
{
    aParams.forEach( ( p, i ) =>
    {
        if( p.eType === ScAddInArgumentType.SC_ADDINARG_VARARGS && aArgs[i] === undefined )
            aArgs[i] = [];
        else if( ( aArgs[i] === undefined || aArgs[i] === null ) && p.eType !== ScAddInArgumentType.SC_ADDINARG_VALUE_OR_ARRAY && p.eType !== ScAddInArgumentType.SC_ADDINARG_CALLER )
            throw new IllegalArgumentException( 'invalid type of argument' );
    } );
    return aArgs;
}

export class AnalysisAddIn implements ScAddInComponent
{
    private aFuncLoc: UnoLocale = { Language: '', Country: '' };
    private pDefLocales: UnoLocale[] | null = null;
    private pFD: FuncDataList | null = null;
    private pFactDoubles: number[] | null = null;
    private pCDL: ConvertDataList | null = null;

    private aAnyConv = new ScaAnyConverter();

    private GetFuncDescrStr( pResId: readonly string[], nStrIndex: number ): string
    {
        return this.AnalysisResId(pResId[nStrIndex - 1]!);
    }

    private InitData(): void
    {
        this.pFD = [];
        InitFuncDataList(this.pFD);

        this.pDefLocales = null;
    }

    /** the function data, initialised by setLocale (or here, if that was not called) */
    private FD(): FuncDataList
    {
        if( !this.pFD )
            this.InitData();
        return this.pFD!;
    }

    private find( aName: string ): FuncData | undefined
    {
        return this.FD().find( FindFuncData( aName ) );
    }

    /// Converts an Any to sal_Int32 in the range from 0 to 4 (date calculation mode).
    private getDateMode( xPropSet: XOpt, rAny: UnoAny ): number
    {
        const nMode = this.aAnyConv.getInt32( xPropSet, rAny, 0 );
        if( (nMode < 0) || (nMode > 4) )
            throw new IllegalArgumentException();
        return nMode;
    }

    FactDouble( nNum: number ): number
    {
        if( nNum < 0 || nNum > MAXFACTDOUBLE )
            throw new IllegalArgumentException();

        if( !this.pFactDoubles )
        {
            this.pFactDoubles = new Array<number>( MAXFACTDOUBLE + 1 );

            this.pFactDoubles[ 0 ] = 1.0;    // by default

            let fOdd = 1.0;
            let fEven = 2.0;

            this.pFactDoubles[ 1 ] = fOdd;
            this.pFactDoubles[ 2 ] = fEven;

            let bOdd = true;

            for( let nCnt = 3 ; nCnt <= MAXFACTDOUBLE ; nCnt++ )
            {
                if( bOdd )
                {
                    fOdd *= nCnt;
                    this.pFactDoubles[ nCnt ] = fOdd;
                }
                else
                {
                    fEven *= nCnt;
                    this.pFactDoubles[ nCnt ] = fEven;
                }

                bOdd = !bOdd;

            }
        }

        return this.pFactDoubles[ nNum ]!;
    }

    // XServiceName
    getServiceName(): string
    {
        // name of specific AddIn service
        return MY_SERVICE;
    }

    // XServiceInfo
    getImplementationName(): string
    {
        return MY_IMPLNAME;
    }

    supportsService( aName: string ): boolean
    {
        return this.getSupportedServiceNames().includes( aName );
    }

    getSupportedServiceNames(): string[]
    {
        return [ ADDIN_SERVICE, MY_SERVICE ];
    }

    // XLocalizable
    setLocale( eLocale: UnoLocale ): void
    {
        this.aFuncLoc = eLocale;

        this.InitData();     // change of locale invalidates resources!
    }

    getLocale(): UnoLocale
    {
        return this.aFuncLoc;
    }

    // XAddIn
    getProgrammaticFuntionName( _aDisplayName: string ): string
    {
        //  not used by calc
        //  (but should be implemented for other uses of the AddIn service)

        return '';
    }

    getDisplayFunctionName( aProgrammaticName: string ): string
    {
        let aRet: string;

        const it = this.find( aProgrammaticName );
        if( it )
        {
            aRet = this.AnalysisResId(it.GetUINameID());
            if( it.IsDouble() )
            {
                const rSuffix = it.GetSuffix();
                if (rSuffix)
                    aRet += rSuffix;
                else
                    aRet += "_ADD";
            }
        }
        else
        {
            aRet = "UNKNOWNFUNC_" + aProgrammaticName;
        }

        return aRet;
    }

    getFunctionDescription( aProgrammaticName: string ): string
    {
        let aRet = '';

        const it = this.find( aProgrammaticName );
        if( it )
            aRet = this.GetFuncDescrStr( it.GetDescrID(), 1 );

        return aRet;
    }

    getDisplayArgumentName( aName: string, nArg: number ): string
    {
        let aRet = '';

        const it = this.find( aName );
        if( it && nArg <= 0xFFFF )
        {
            const nStr = it.GetStrIndex( nArg );
            if( nStr )
                aRet = this.GetFuncDescrStr( it.GetDescrID(), nStr );
            else
                aRet = "internal";
        }

        return aRet;
    }

    getArgumentDescription( aName: string, nArg: number ): string
    {
        let aRet = '';

        const it = this.find( aName );
        if( it && nArg <= 0xFFFF )
        {
            const nStr = it.GetStrIndex( nArg );
            if( nStr )
                aRet = this.GetFuncDescrStr( it.GetDescrID(), nStr + 1 );
            else
                aRet = "for internal use only";
        }

        return aRet;
    }

    getProgrammaticCategoryName( aName: string ): string
    {
        //  return non-translated strings
        //  return OUString( "Add-In" );
        const it = this.find( aName );
        let aRet = '';
        if( it )
        {
            switch( it.GetCategory() )
            {
                case FDCategory.DateTime:    aRet = "Date&Time";         break;
                case FDCategory.Finance:     aRet = "Financial";         break;
                case FDCategory.Inf:         aRet = "Information";       break;
                case FDCategory.Math:        aRet = "Mathematical";      break;
                case FDCategory.Tech:        aRet = "Technical";         break;
            }
        }
        else
            aRet = pDefCatName;

        return aRet;
    }

    getDisplayCategoryName( aProgrammaticFunctionName: string ): string
    {
        //  return translated strings, not used for predefined categories
        const it = this.find( aProgrammaticFunctionName );
        let aRet = '';
        if( it )
        {
            switch( it.GetCategory() )
            {
                case FDCategory.DateTime:    aRet = "Date&Time";         break;
                case FDCategory.Finance:     aRet = "Financial";         break;
                case FDCategory.Inf:         aRet = "Information";       break;
                case FDCategory.Math:        aRet = "Mathematical";      break;
                case FDCategory.Tech:        aRet = "Technical";         break;
            }
        }
        else
            aRet = pDefCatName;

        return aRet;
    }

    private InitDefLocales(): void
    {
        this.pDefLocales = [];

        for( let n = 0 ; n < nNumOfLoc ; n++ )
        {
            this.pDefLocales[ n ] = { Language: pLang[ n ]!, Country: pCoun[ n ]! };
        }
    }

    private GetLocale( nInd: number ): UnoLocale
    {
        if( !this.pDefLocales )
            this.InitDefLocales();

        if( nInd < nNumOfLoc )
            return this.pDefLocales![ nInd ]!;
        else
            return this.aFuncLoc;
    }

    getCompatibilityNames( aProgrammaticName: string ): LocalizedName[]
    {
        const it = this.find( aProgrammaticName );
        if( !it )
            return [];

        const r = it.GetCompNameList();
        const nCount = r.length;

        const aRet: LocalizedName[] = [];

        for( let n = 0 ; n < nCount ; n++ )
        {
            aRet[ n ] = { Locale: this.GetLocale( n ), Name: r[n]! };
        }

        return aRet;
    }

    /** The methods of XAnalysis, as UNO introspection gives them to ScUnoAddInCollection. */
    getMethods(): ScAddInMethod[]
    {
        return XAnalysis.map( ( m ) => ( {
            getName: () => m.aName,
            getParameterInfos: () => [ ...m.aParams ],
            invoke: ( aArgs: unknown[] ) => ( this as unknown as Record<string, ( ...a: unknown[] ) => UnoAny> )[ m.aName ]!.apply( this, lcl_CheckArgs( m.aParams, [ ...aArgs ] ) ),
        } ) );
    }

    //  methods from own interfaces start here

    // XAnalysis
    /** Workday */
    getWorkday( xOptions: XOpt, nDate: number, nDays: number, aHDay: UnoAny ): number
    {
        if( !nDays )
            return nDate;

        const nNullDate = GetNullDate( xOptions );

        const aSrtLst = new SortedIndividualInt32List();

        aSrtLst.InsertHolidayList( this.aAnyConv, xOptions, aHDay, nNullDate );

        let nActDate = nDate + nNullDate;

        if( nDays > 0 )
        {
            if( GetDayOfWeek( nActDate ) === 5 )
                // when starting on Saturday, assuming we're starting on Sunday to get the jump over the weekend
                nActDate++;

            while( nDays )
            {
                nActDate++;

                if( GetDayOfWeek( nActDate ) < 5 )
                {
                    if( !aSrtLst.Find( nActDate ) )
                        nDays--;
                }
                else
                    nActDate++;     // jump over weekend
            }
        }
        else
        {
            if( GetDayOfWeek( nActDate ) === 6 )
                // when starting on Sunday, assuming we're starting on Saturday to get the jump over the weekend
                nActDate--;

            while( nDays )
            {
                nActDate--;

                if( GetDayOfWeek( nActDate ) < 5 )
                {
                    if( !aSrtLst.Find( nActDate ) )
                        nDays++;
                }
                else
                    nActDate--;     // jump over weekend
            }
        }

        return nActDate - nNullDate;
    }

    /** Yearfrac */
    getYearfrac( xOpt: XOpt, nStartDate: number, nEndDate: number, rMode: UnoAny ): number
    {
        const fRet = GetYearFrac( xOpt, nStartDate, nEndDate, this.getDateMode( xOpt, rMode ) );
        return finiteOrThrow( fRet );
    }

    getEdate( xOpt: XOpt, nStartDate: number, nMonths: number ): number
    {
        const nNullDate = GetNullDate( xOpt );
        const aDate = new ScaDate( nNullDate, nStartDate, 5 );
        aDate.addMonths( nMonths );
        return aDate.getDate( nNullDate );
    }

    getWeeknum( xOpt: XOpt, nDate: number, nMode: number ): number
    {
        nDate += GetNullDate( xOpt );

        const [ , , nYear ] = DaysToDate( nDate );

        const nFirstInYear = DateToDays( 1, 1, nYear );
        const nFirstDayInYear = GetDayOfWeek( nFirstInYear );

        return Math.trunc( ( nDate - nFirstInYear + ( ( nMode === 1 )? ( nFirstDayInYear + 1 ) % 7 : nFirstDayInYear ) ) / 7 ) + 1;
    }

    getEomonth( xOpt: XOpt, nDate: number, nMonths: number ): number
    {
        const nNullDate = GetNullDate( xOpt );
        nDate += nNullDate;
        let [ , nMonth, nYear ] = DaysToDate( nDate );

        let nNewMonth = nMonth + nMonths;

        if( nNewMonth > 12 )
        {
            nYear = ( nYear + Math.trunc( nNewMonth / 12 ) ) & 0xFFFF;
            nNewMonth %= 12;
        }
        else if( nNewMonth < 1 )
        {
            nNewMonth = -nNewMonth;
            nYear = ( nYear - Math.trunc( nNewMonth / 12 ) ) & 0xFFFF;
            nYear = ( nYear - 1 ) & 0xFFFF;
            nNewMonth %= 12;
            nNewMonth = 12 - nNewMonth;
        }
        nMonth = nNewMonth & 0xFFFF;

        return DateToDays( DaysInMonth( nMonth, nYear ), nMonth, nYear ) - nNullDate;
    }

    getNetworkdays( xOpt: XOpt, nStartDate: number, nEndDate: number, aHDay: UnoAny ): number
    {
        const nNullDate = GetNullDate( xOpt );

        const aSrtLst = new SortedIndividualInt32List();

        aSrtLst.InsertHolidayList( this.aAnyConv, xOpt, aHDay, nNullDate );

        let nActDate = nStartDate + nNullDate;
        const nStopDate = nEndDate + nNullDate;
        let nCnt = 0;

        if( nActDate <= nStopDate )
        {
            while( nActDate <= nStopDate )
            {
                if( GetDayOfWeek( nActDate ) < 5 && !aSrtLst.Find( nActDate ) )
                    nCnt++;

                nActDate++;
            }
        }
        else
        {
            while( nActDate >= nStopDate )
            {
                if( GetDayOfWeek( nActDate ) < 5 && !aSrtLst.Find( nActDate ) )
                    nCnt--;

                nActDate--;
            }
        }

        return nCnt;
    }

    getIseven( nVal: number ): number
    {
        return ( nVal & 0x00000001 )? 0 : 1;
    }

    getIsodd( nVal: number ): number
    {
        return ( nVal & 0x00000001 )? 1 : 0;
    }

    getMultinomial( xOpt: XOpt, aVLst: Seq2<number>, aOptVLst: readonly UnoAny[] ): number
    {
        const aValList = new ScaDoubleListGE0();

        aValList.Append( aVLst );
        aValList.Append( this.aAnyConv, xOpt, aOptVLst );

        if( aValList.Count() === 0 )
            return 0.0;

        let nZ = 0;
        let fRet = 1.0;

        for( let i = 0; i < aValList.Count(); ++i )
        {
            const d = aValList.Get(i);
            const n = (d >= 0.0) ? approxFloor( d ) : approxCeil( d );
            if ( n < 0.0 )
                throw new IllegalArgumentException();

            if( n > 0.0 )
            {
                nZ += n;
                fRet *= BinomialCoefficient(nZ, n);
            }
        }
        return finiteOrThrow( fRet );
    }

    getSeriessum( fX: number, fN: number, fM: number, aCoeffList: Seq2<number> ): number
    {
        let fRet = 0.0;

        // #i32269# 0^0 is undefined, Excel returns #NUM! error
        if( fX === 0.0 && fN === 0 )
            throw new RuntimeException("undefined expression: 0^0");

        if( fX !== 0.0 )
        {
            for( const rList of aCoeffList )
            {
                for( const fCoef of rList )
                {
                    fRet += fCoef * Math.pow( fX, fN );

                    fN += fM;
                }
            }
        }

        return finiteOrThrow( fRet );
    }

    getQuotient( fNum: number, fDenom: number ): number
    {
        let fRet: number;
        if( (fNum < 0) !== (fDenom < 0) )
            fRet = approxCeil( fNum / fDenom );
        else
            fRet = approxFloor( fNum / fDenom );
        return finiteOrThrow( fRet );
    }

    getMround( fNum: number, fMult: number ): number
    {
        if( fMult === 0.0 )
            return fMult;

        const fRet = fMult * rtl_math_round( approxValue( fNum / fMult));
        return finiteOrThrow( fRet );
    }

    getSqrtpi( fNum: number ): number
    {
        const fRet = Math.sqrt( fNum * Math.PI );
        return finiteOrThrow( fRet );
    }

    getRandbetween( fMin: number, fMax: number ): number
    {
        fMin = rtl_math_round( fMin, 0, rtl_math_RoundingMode.Up );
        fMax = rtl_math_round( fMax, 0, rtl_math_RoundingMode.Up );
        if( fMin > fMax )
            throw new IllegalArgumentException();

        const fUpper = nextDown(fMax+1);
        const fRet = Math.floor(fMin + (fUpper - fMin) * Math.random()); // comphelper::rng::uniform_real_distribution
        return finiteOrThrow( fRet );
    }

    getGcd( xOpt: XOpt, aVLst: Seq2<number>, aOptVLst: readonly UnoAny[] ): number
    {
        const aValList = new ScaDoubleListGT0();

        aValList.Append( aVLst );
        aValList.Append( this.aAnyConv, xOpt, aOptVLst );

        if( aValList.Count() === 0 )
            return 0.0;

        let f = aValList.Get(0);
        for( let i = 1; i < aValList.Count(); ++i )
        {
            f = GetGcd( aValList.Get(i), f );
        }

        return finiteOrThrow( f );
    }

    getLcm( xOpt: XOpt, aVLst: Seq2<number>, aOptVLst: readonly UnoAny[] ): number
    {
        const aValList = new ScaDoubleListGE0();

        aValList.Append( aVLst );
        aValList.Append( this.aAnyConv, xOpt, aOptVLst );

        if( aValList.Count() === 0 )
            return 0.0;

        let f = approxFloor( aValList.Get(0) );
        if( f < 0.0 )
            throw new IllegalArgumentException();

        if( f === 0.0 )
            return f;

        for( let i = 1; i < aValList.Count(); ++i )
        {
            const fTmp = approxFloor( aValList.Get(i) );
            if( fTmp < 0.0 )
                throw new IllegalArgumentException();

            f = fTmp * f / GetGcd( fTmp, f );
            if( f === 0.0 )
                return f;
        }

        return finiteOrThrow( f );
    }

    getBesseli( fNum: number, nOrder: number ): number
    {
        const fRet = BesselI( fNum, nOrder );
        return finiteOrThrow( fRet );
    }

    getBesselj( fNum: number, nOrder: number ): number
    {
        const fRet = BesselJ( fNum, nOrder );
        return finiteOrThrow( fRet );
    }

    getBesselk( fNum: number, nOrder: number ): number
    {
        if( nOrder < 0 || fNum <= 0.0 )
            throw new IllegalArgumentException();

        const fRet = BesselK( fNum, nOrder );
        return finiteOrThrow( fRet );
    }

    getBessely( fNum: number, nOrder: number ): number
    {
        if( nOrder < 0 || fNum <= 0.0 )
            throw new IllegalArgumentException();

        const fRet = BesselY( fNum, nOrder );
        return finiteOrThrow( fRet );
    }

    getBin2Oct( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 2, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN8, SCA_MAX8, 8, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getBin2Dec( aNum: string ): number
    {
        const fRet = ConvertToDec( aNum, 2, SCA_MAXPLACES );
        return finiteOrThrow( fRet );
    }

    getBin2Hex( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 2, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN16, SCA_MAX16, 16, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getOct2Bin( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 8, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN2, SCA_MAX2, 2, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getOct2Dec( aNum: string ): number
    {
        const fRet = ConvertToDec( aNum, 8, SCA_MAXPLACES );
        return finiteOrThrow( fRet );
    }

    getOct2Hex( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 8, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN16, SCA_MAX16, 16, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getDec2Bin( xOpt: XOpt, nNum: number, rPlaces: UnoAny ): string
    {
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( nNum, SCA_MIN2, SCA_MAX2, 2, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getDec2Oct( xOpt: XOpt, nNum: number, rPlaces: UnoAny ): string
    {
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( nNum, SCA_MIN8, SCA_MAX8, 8, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getDec2Hex( xOpt: XOpt, fNum: number, rPlaces: UnoAny ): string
    {
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fNum, SCA_MIN16, SCA_MAX16, 16, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getHex2Bin( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 16, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN2, SCA_MAX2, 2, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getHex2Dec( aNum: string ): number
    {
        const fRet = ConvertToDec( aNum, 16, SCA_MAXPLACES );
        return finiteOrThrow( fRet );
    }

    getHex2Oct( xOpt: XOpt, aNum: string, rPlaces: UnoAny ): string
    {
        const fVal = ConvertToDec( aNum, 16, SCA_MAXPLACES );
        const nPlaces = { value: 0 };
        const bUsePlaces = this.aAnyConv.getInt32( nPlaces, xOpt, rPlaces );
        return ConvertFromDec( fVal, SCA_MIN8, SCA_MAX8, 8, nPlaces.value, SCA_MAXPLACES, bUsePlaces );
    }

    getDelta( xOpt: XOpt, fNum1: number, rNum2: UnoAny ): number
    {
        return Number(fNum1 === this.aAnyConv.getDouble( xOpt, rNum2, 0.0 ));
    }

    getErf( xOpt: XOpt, fLL: number, rUL: UnoAny ): number
    {
        const fUL = { value: 0 };
        const bContainsValue = this.aAnyConv.getDouble( fUL, xOpt, rUL );

        const fRet = bContainsValue ? (Erf( fUL.value ) - Erf( fLL )) : Erf( fLL );
        return finiteOrThrow( fRet );
    }

    getErfc( f: number ): number
    {
        const fRet = Erfc( f );
        return finiteOrThrow( fRet );
    }

    getGestep( xOpt: XOpt, fNum: number, rStep: UnoAny ): number
    {
        return Number(fNum >= this.aAnyConv.getDouble( xOpt, rStep, 0.0 ));
    }

    getFactdouble( nNum: number ): number
    {
        const fRet = this.FactDouble( nNum );
        return finiteOrThrow( fRet );
    }

    getImabs( aNum: string ): number
    {
        const fRet = new Complex( aNum ).Abs();
        return finiteOrThrow( fRet );
    }

    getImaginary( aNum: string ): number
    {
        const fRet = new Complex( aNum ).Imag();
        return finiteOrThrow( fRet );
    }

    getImpower( aNum: string, f: number ): string
    {
        const z = new Complex( aNum );

        z.Power( f );

        return z.GetString();
    }

    getImargument( aNum: string ): number
    {
        const fRet = new Complex( aNum ).Arg();
        return finiteOrThrow( fRet );
    }

    getImcos( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Cos();

        return z.GetString();
    }

    getImdiv( aDivid: string, aDivis: string ): string
    {
        const z = new Complex( aDivid );

        z.Div( new Complex( aDivis ) );

        return z.GetString();
    }

    getImexp( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Exp();

        return z.GetString();
    }

    getImconjugate( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Conjugate();

        return z.GetString();
    }

    getImln( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Ln();

        return z.GetString();
    }

    getImlog10( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Log10();

        return z.GetString();
    }

    getImlog2( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Log2();

        return z.GetString();
    }

    getImproduct( _xOpt: XOpt, aNum1: Seq2<string>, aNL: readonly UnoAny[] ): string
    {
        const z_list = new ComplexList();

        z_list.Append_StrSeqSeq( aNum1 );
        z_list.Append_AnySeq( aNL );

        if( z_list.empty() )
            return new Complex( 0 ).GetString();

        const z = new Complex( z_list.Get(0) );
        for( let i = 1; i < z_list.Count(); ++i )
            z.Mult( z_list.Get(i) );

        return z.GetString();
    }

    getImreal( aNum: string ): number
    {
        const fRet = new Complex( aNum ).Real();
        return finiteOrThrow( fRet );
    }

    getImsin( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Sin();

        return z.GetString();
    }

    getImsub( aNum1: string, aNum2: string ): string
    {
        const z = new Complex( aNum1 );

        z.Sub( new Complex( aNum2 ) );

        return z.GetString();
    }

    getImsum( _xOpt: XOpt, aNum1: Seq2<string>, aFollowingPars: readonly UnoAny[] ): string
    {
        const z_list = new ComplexList();

        z_list.Append_StrSeqSeq( aNum1 );
        z_list.Append_AnySeq( aFollowingPars );

        if( z_list.empty() )
            return new Complex( 0 ).GetString();

        const z = new Complex( z_list.Get(0) );
        for( let i = 1; i < z_list.Count(); ++i )
            z.Add( z_list.Get(i) );

        return z.GetString();
    }

    getImsqrt( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Sqrt();

        return z.GetString();
    }

    getImtan( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Tan();

        return z.GetString();
    }

    getImsec( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Sec();

        return z.GetString();
    }

    getImcsc( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Csc();

        return z.GetString();
    }

    getImcot( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Cot();

        return z.GetString();
    }

    getImsinh( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Sinh();

        return z.GetString();
    }

    getImcosh( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Cosh();

        return z.GetString();
    }

    getImsech( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Sech();

        return z.GetString();
    }

    getImcsch( aNum: string ): string
    {
        const z = new Complex( aNum );

        z.Csch();

        return z.GetString();
    }

    getComplex( fR: number, fI: number, rSuff: UnoAny ): string
    {
        let bi: boolean;

        if( rSuff === undefined || rSuff === null )     // TypeClass_VOID
            bi = true;
        else if( typeof rSuff === 'string' )            // TypeClass_STRING
        {
            const pSuff = rSuff;
            bi = pSuff === "i" || !pSuff;
            if( !bi && pSuff !== "j" )
                throw new IllegalArgumentException();
        }
        else
            throw new IllegalArgumentException();

        return new Complex( fR, fI, bi ? 'i' : 'j' ).GetString();
    }

    getConvert( f: number, aFU: string, aTU: string ): number
    {
        if( !this.pCDL )
            this.pCDL = new ConvertDataList();

        const fRet = this.pCDL.Convert( f, aFU, aTU );
        return finiteOrThrow( fRet );
    }

    AnalysisResId( aResId: string ): string
    {
        return aResId;
    }

    // --- financial.cxx ---------------------------------------------------------------------------

    getAmordegrc( xOpt: XOpt,
        fCost: number, nDate: number, nFirstPer: number, fRestVal: number,
        fPer: number, fRate: number, rOB: UnoAny ): number
    {
        if( nDate > nFirstPer || fRate <= 0.0 || fRestVal > fCost ||
            fCost <= 0.0 || fRestVal < 0 || fPer < 0 )
            throw new IllegalArgumentException();

        const fRet = GetAmordegrc( GetNullDate( xOpt ), fCost, nDate, nFirstPer, fRestVal, fPer, fRate, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getAmorlinc( xOpt: XOpt,
        fCost: number, nDate: number, nFirstPer: number, fRestVal: number,
        fPer: number, fRate: number, rOB: UnoAny ): number
    {
        if ( nDate > nFirstPer || fRate <= 0.0 || fRestVal > fCost ||
             fCost <= 0.0 || fRestVal < 0 || fPer < 0 )
            throw new IllegalArgumentException();

        const fRet = GetAmorlinc( GetNullDate( xOpt ), fCost, nDate, nFirstPer, fRestVal, fPer, fRate, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getAccrint( xOpt: XOpt,
        nIssue: number, _nFirstInter: number, nSettle: number, fRate: number,
        rVal: UnoAny, nFreq: number, rOB: UnoAny ): number
    {
        const fVal = this.aAnyConv.getDouble( xOpt, rVal, 1000.0 );

        if( fRate <= 0.0 || fVal <= 0.0 || isFreqInvalid(nFreq) || nIssue >= nSettle)
            throw new IllegalArgumentException();

        const fRet = fVal * fRate * GetYearDiff( GetNullDate( xOpt ), nIssue, nSettle, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getAccrintm( xOpt: XOpt,
        nIssue: number, nSettle: number, fRate: number, rVal: UnoAny, rOB: UnoAny ): number
    {
        const fVal = this.aAnyConv.getDouble( xOpt, rVal, 1000.0 );

        if( fRate <= 0.0 || fVal <= 0.0 || nIssue >= nSettle )
            throw new IllegalArgumentException();

        const fRet = fVal * fRate * GetYearDiff( GetNullDate( xOpt ), nIssue, nSettle, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getReceived( xOpt: XOpt,
        nSettle: number, nMat: number, fInvest: number, fDisc: number, rOB: UnoAny ): number
    {
        if( fInvest <= 0.0 || fDisc <= 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = fInvest / ( 1.0 - ( fDisc * GetYearDiff( GetNullDate( xOpt ), nSettle, nMat, this.getDateMode( xOpt, rOB ) ) ) );
        return finiteOrThrow( fRet );
    }


    getDisc( xOpt: XOpt,
        nSettle: number, nMat: number, fPrice: number, fRedemp: number, rOB: UnoAny ): number
    {
        if( fPrice <= 0.0 || fRedemp <= 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();
        const fRet = ( 1.0 - fPrice / fRedemp ) / GetYearFrac( xOpt, nSettle, nMat, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getDuration( xOpt: XOpt,
        nSettle: number, nMat: number, fCoup: number, fYield: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fCoup < 0.0 || fYield < 0.0 || isFreqInvalid(nFreq) || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = GetDuration( GetNullDate( xOpt ),  nSettle, nMat, fCoup, fYield, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getEffect( fNominal: number, nPeriods: number ): number
    {
        if( nPeriods < 1 || fNominal <= 0.0 )
            throw new IllegalArgumentException();

        const fPeriods = nPeriods;

        const fRet = Math.pow( 1.0 + fNominal / fPeriods, fPeriods ) - 1.0;
        return finiteOrThrow( fRet );
    }


    getCumprinc( fRate: number, nNumPeriods: number, fVal: number,
        nStartPer: number, nEndPer: number, nPayType: number ): number
    {
        if( nStartPer < 1 || nEndPer < nStartPer || fRate <= 0.0 || nEndPer > nNumPeriods ||
            fVal <= 0.0 || ( nPayType !== 0 && nPayType !== 1 ) )
            throw new IllegalArgumentException();

        const fPmt = GetPmt( fRate, nNumPeriods, fVal, 0.0, nPayType );

        let fPpmt = 0.0;

        let nStart = nStartPer;
        const nEnd = nEndPer;

        if( nStart === 1 )
        {
            if( nPayType <= 0 )
                fPpmt = fPmt + fVal * fRate;
            else
                fPpmt = fPmt;

            nStart++;
        }

        for( let i = nStart ; i <= nEnd ; i++ )
        {
            if( nPayType > 0 )
                fPpmt += fPmt - ( GetFv( fRate, i - 2, fPmt, fVal, 1 ) - fPmt ) * fRate;
            else
                fPpmt += fPmt - GetFv( fRate, i - 1, fPmt, fVal, 0 ) * fRate;
        }

        return finiteOrThrow( fPpmt );
    }


    getCumipmt( fRate: number, nNumPeriods: number, fVal: number,
        nStartPer: number, nEndPer: number, nPayType: number ): number
    {
        if( nStartPer < 1 || nEndPer < nStartPer || fRate <= 0.0 || nEndPer > nNumPeriods ||
            fVal <= 0.0 || ( nPayType !== 0 && nPayType !== 1 ) )
            throw new IllegalArgumentException();

        const fPmt = GetPmt( fRate, nNumPeriods, fVal, 0.0, nPayType );

        let fIpmt = 0.0;

        let nStart = nStartPer;
        const nEnd = nEndPer;

        if( nStart === 1 )
        {
            if( nPayType <= 0 )
                fIpmt = -fVal;

            nStart++;
        }

        for( let i = nStart ; i <= nEnd ; i++ )
        {
            if( nPayType > 0 )
                fIpmt += GetFv( fRate, i - 2, fPmt, fVal, 1 ) - fPmt;
            else
                fIpmt += GetFv( fRate, i - 1, fPmt, fVal, 0 );
        }

        fIpmt *= fRate;

        return finiteOrThrow( fIpmt );
    }


    getPrice( xOpt: XOpt,
        nSettle: number, nMat: number, fRate: number, fYield: number, fRedemp: number, nFreq: number,
        rOB: UnoAny ): number
    {
        if( fYield < 0.0 || fRate < 0.0 || fRedemp <= 0.0 || isFreqInvalid(nFreq) || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = getPrice_( GetNullDate( xOpt ), nSettle, nMat, fRate, fYield, fRedemp, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getPricedisc( xOpt: XOpt,
        nSettle: number, nMat: number, fDisc: number, fRedemp: number, rOB: UnoAny ): number
    {
        if( fDisc <= 0.0 || fRedemp <= 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = fRedemp * ( 1.0 - fDisc * GetYearDiff( GetNullDate( xOpt ), nSettle, nMat, this.getDateMode( xOpt, rOB ) ) );
        return finiteOrThrow( fRet );
    }


    getPricemat( xOpt: XOpt,
        nSettle: number, nMat: number, nIssue: number, fRate: number, fYield: number, rOB: UnoAny ): number
    {
        if( fRate < 0.0 || fYield < 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();

        const nNullDate = GetNullDate( xOpt );
        const nBase = this.getDateMode( xOpt, rOB );

        const fIssMat = GetYearFrac( nNullDate, nIssue, nMat, nBase );
        const fIssSet = GetYearFrac( nNullDate, nIssue, nSettle, nBase );
        const fSetMat = GetYearFrac( nNullDate, nSettle, nMat, nBase );

        let fRet = 1.0 + fIssMat * fRate;
        fRet /= 1.0 + fSetMat * fYield;
        fRet -= fIssSet * fRate;
        fRet *= 100.0;

        return finiteOrThrow( fRet );
    }


    getMduration( xOpt: XOpt,
        nSettle: number, nMat: number, fCoup: number, fYield: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fCoup < 0.0 || fYield < 0.0 || isFreqInvalid(nFreq) )
            throw new IllegalArgumentException();

        let fRet = GetDuration( GetNullDate( xOpt ),  nSettle, nMat, fCoup, fYield, nFreq, this.getDateMode( xOpt, rOB ) );
        fRet /= 1.0 + ( fYield / nFreq );
        return finiteOrThrow( fRet );
    }


    getNominal( fRate: number, nPeriods: number ): number
    {
        if( fRate <= 0.0 || nPeriods < 0 )
            throw new IllegalArgumentException();

        const fPeriods = nPeriods;
        const fRet = ( Math.pow( fRate + 1.0, 1.0 / fPeriods ) - 1.0 ) * fPeriods;
        return finiteOrThrow( fRet );
    }


    getDollarfr( fDollarDec: number, nFrac: number ): number
    {
        if( nFrac <= 0 )
            throw new IllegalArgumentException();

        const fInt = { value: 0 };
        const fFrac = nFrac;

        let fRet = modf( fDollarDec, fInt );

        fRet *= fFrac;

        fRet *= Math.pow( 10.0, -Math.ceil( Math.log10( fFrac ) ) );

        fRet += fInt.value;

        return finiteOrThrow( fRet );
    }


    getDollarde( fDollarFrac: number, nFrac: number ): number
    {
        if( nFrac <= 0 )
            throw new IllegalArgumentException();

        const fInt = { value: 0 };
        const fFrac = nFrac;

        let fRet = modf( fDollarFrac, fInt );

        fRet /= fFrac;

        fRet *= Math.pow( 10.0, Math.ceil( Math.log10( fFrac ) ) );

        fRet += fInt.value;

        return finiteOrThrow( fRet );
    }


    getYield( xOpt: XOpt,
        nSettle: number, nMat: number, fCoup: number, fPrice: number, fRedemp: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fCoup < 0.0 || fPrice <= 0.0 || fRedemp <= 0.0 || isFreqInvalid(nFreq) || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = getYield_( GetNullDate( xOpt ), nSettle, nMat, fCoup, fPrice, fRedemp, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getYielddisc( xOpt: XOpt,
        nSettle: number, nMat: number, fPrice: number, fRedemp: number, rOB: UnoAny ): number
    {
        if( fPrice <= 0.0 || fRedemp <= 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();

        const nNullDate = GetNullDate( xOpt );

        let fRet = ( fRedemp / fPrice ) - 1.0;
        fRet /= GetYearFrac( nNullDate, nSettle, nMat, this.getDateMode( xOpt, rOB ) );

        return finiteOrThrow( fRet );
    }


    getYieldmat( xOpt: XOpt,
        nSettle: number, nMat: number, nIssue: number, fRate: number, fPrice: number, rOB: UnoAny ): number
    {
        if( fPrice <= 0.0 || fRate < 0.0 || nSettle >= nMat || nSettle < nIssue)
            throw new IllegalArgumentException();

        const fRet = GetYieldmat( GetNullDate( xOpt ),  nSettle, nMat, nIssue, fRate, fPrice, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getTbilleq( xOpt: XOpt,
        nSettle: number, nMat: number, fDisc: number ): number
    {
        nMat++;

        const nDiff = GetDiffDate360( xOpt, nSettle, nMat, true );

        if( fDisc <= 0.0 || nSettle >= nMat || nDiff > 360 )
            throw new IllegalArgumentException();

        const fRet = ( 365 * fDisc ) / ( 360 - ( fDisc * nDiff ) );
        return finiteOrThrow( fRet );
    }


    getTbillprice( xOpt: XOpt,
        nSettle: number, nMat: number, fDisc: number ): number
    {
        if( fDisc <= 0.0 || nSettle > nMat )
            throw new IllegalArgumentException();

        nMat++;

        const fFraction = GetYearFrac( xOpt, nSettle, nMat, 0 );  // method: USA 30/360

        if( modf( fFraction, { value: 0 } ) === 0.0 )
            throw new IllegalArgumentException();

        const fRet = 100.0 * ( 1.0 - fDisc * fFraction );
        return finiteOrThrow( fRet );
    }


    getTbillyield( xOpt: XOpt, nSettle: number, nMat: number, fPrice: number ): number
    {
        let nDiff = GetDiffDate360( xOpt, nSettle, nMat, true );
        nDiff++;

        if( fPrice <= 0.0 || nSettle >= nMat || nDiff > 360 )
            throw new IllegalArgumentException();

        let fRet = 100.0;
        fRet /= fPrice;
        fRet--;
        fRet /= nDiff;
        fRet *= 360.0;

        return finiteOrThrow( fRet );
    }

    // Encapsulation violation: We *know* that GetOddfprice() always
    // throws.

    getOddfprice( xOpt: XOpt,
        nSettle: number, nMat: number, nIssue: number, nFirstCoup: number,
        fRate: number, fYield: number, fRedemp: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fRate < 0.0 || fYield < 0.0 || isFreqInvalid(nFreq) || nMat <= nFirstCoup || nFirstCoup <= nSettle || nSettle <= nIssue )
            throw new IllegalArgumentException();

        const fRet = GetOddfprice( GetNullDate( xOpt ), nSettle, nMat, nIssue, nFirstCoup, fRate, fYield, fRedemp, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }

    // Encapsulation violation: We *know* that Getoddfyield() always
    // throws.

    getOddfyield( xOpt: XOpt,
        nSettle: number, nMat: number, nIssue: number, nFirstCoup: number,
        fRate: number, fPrice: number, fRedemp: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fRate < 0.0 || fPrice <= 0.0 || isFreqInvalid(nFreq) || nMat <= nFirstCoup || nFirstCoup <= nSettle || nSettle <= nIssue )
            throw new IllegalArgumentException();

        const fRet = GetOddfyield( GetNullDate( xOpt ), nSettle, nMat, nIssue, nFirstCoup, fRate, fPrice, fRedemp, nFreq,
                            this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }

    getOddlprice( xOpt: XOpt,
        nSettle: number, nMat: number, nLastInterest: number,
        fRate: number, fYield: number, fRedemp: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fRate <= 0.0 || fYield < 0.0 || fRedemp <= 0.0 || isFreqInvalid(nFreq) || nMat <= nSettle || nSettle <= nLastInterest )
            throw new IllegalArgumentException();

        const fRet = GetOddlprice( GetNullDate( xOpt ), nSettle, nMat, nLastInterest, fRate, fYield, fRedemp, nFreq,
                            this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getOddlyield( xOpt: XOpt,
        nSettle: number, nMat: number, nLastInterest: number,
        fRate: number, fPrice: number, fRedemp: number, nFreq: number, rOB: UnoAny ): number
    {
        if( fRate <= 0.0 || fPrice <= 0.0 || fRedemp <= 0.0 || isFreqInvalid(nFreq) || nMat <= nSettle || nSettle <= nLastInterest )
            throw new IllegalArgumentException();

        const fRet = GetOddlyield( GetNullDate( xOpt ), nSettle, nMat, nLastInterest, fRate, fPrice, fRedemp, nFreq,
                            this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }

    // XIRR calculation

    getXirr( xOpt: XOpt, rValues: Seq2<number>, rDates: Seq2<number>, rGuessRate: UnoAny ): number
    {
        const aValues = new ScaDoubleList(), aDates = new ScaDoubleList();
        aValues.Append( rValues );
        aDates.Append( rDates );

        if( (aValues.Count() < 2) || (aValues.Count() !== aDates.Count()) )
            throw new IllegalArgumentException();

        // result interest rate, initialized with passed guessed rate, or 10%
        let fResultRate = this.aAnyConv.getDouble( xOpt, rGuessRate, 0.1 );
        if( fResultRate <= -1 )
            throw new IllegalArgumentException();

        // maximum epsilon for end of iteration
        const fMaxEps = 1e-10;
        // maximum number of iterations
        const nMaxIter = 50;

        // Newton's method - try to find a fResultRate, so that lcl_sca_XirrResult() returns 0.
        let nIter = 0;
        let fResultValue: number;
        let nIterScan = 0;
        let bContLoop = false;
        let bResultRateScanEnd = false;

        // First the inner while-loop will be executed using the default Value fResultRate
        // or the user guessed fResultRate if those do not deliver a solution for the
        // Newton's method then the range from -0.99 to +0.99 will be scanned with a
        // step size of 0.01 to find fResultRate's value which can deliver a solution
        do
        {
            if (nIterScan >=1)
                fResultRate = -0.99 + (nIterScan -1)* 0.01;
            do
            {
                fResultValue = lcl_sca_XirrResult( aValues, aDates, fResultRate );
                const fNewRate = fResultRate - fResultValue / lcl_sca_XirrResult_Deriv1(aValues, aDates, fResultRate); // o3tl::div_allow_zero
                const fRateEps = Math.abs( fNewRate - fResultRate );
                fResultRate = fNewRate;
                bContLoop = (fRateEps > fMaxEps) && (Math.abs( fResultValue ) > fMaxEps);
            }
            while( bContLoop && (++nIter < nMaxIter) );
            nIter = 0;
            if (  Number.isNaN(fResultRate)  || !Number.isFinite(fResultRate)
                ||Number.isNaN(fResultValue) || !Number.isFinite(fResultValue))
                bContLoop = true;

            ++nIterScan;
            bResultRateScanEnd = (nIterScan >= 200);
        }
        while(bContLoop && !bResultRateScanEnd);

        if( bContLoop )
            throw new IllegalArgumentException();
        return finiteOrThrow( fResultRate );
    }


    getXnpv( fRate: number, rValues: Seq2<number>, rDates: Seq2<number> ): number
    {
        const aValList = new ScaDoubleList();
        const aDateList = new ScaDoubleList();

        aValList.Append( rValues );
        aDateList.Append( rDates );

        const nNum = aValList.Count();

        if( nNum !== aDateList.Count() || nNum < 2 )
            throw new IllegalArgumentException();

        let fRet = 0.0;
        const fNull = aDateList.Get( 0 );
        fRate++;

        for( let i = 0 ; i < nNum ; i++ )
            fRet += aValList.Get( i ) / ( Math.pow( fRate, ( aDateList.Get( i ) - fNull ) / 365.0 ) );

        return finiteOrThrow( fRet );
    }


    getIntrate( xOpt: XOpt,
        nSettle: number, nMat: number, fInvest: number, fRedemp: number, rOB: UnoAny ): number
    {
        if( fInvest <= 0.0 || fRedemp <= 0.0 || nSettle >= nMat )
            throw new IllegalArgumentException();

        const fRet = ( ( fRedemp / fInvest ) - 1.0 ) / GetYearDiff( GetNullDate( xOpt ), nSettle, nMat, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCoupncd( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCoupncd( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCoupdays( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCoupdays( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCoupdaysnc( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCoupdaysnc( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCoupdaybs( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCoupdaybs( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCouppcd( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCouppcd( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getCoupnum( xOpt: XOpt,
        nSettle: number, nMat: number, nFreq: number, rOB: UnoAny ): number
    {
        const fRet = GetCoupnum( GetNullDate( xOpt ), nSettle, nMat, nFreq, this.getDateMode( xOpt, rOB ) );
        return finiteOrThrow( fRet );
    }


    getFvschedule( fPrinc: number, rSchedule: Seq2<number> ): number
    {
        const aSchedList = new ScaDoubleList();

        aSchedList.Append( rSchedule );

        for( let i = 0; i < aSchedList.Count(); ++i )
            fPrinc *= 1.0 + aSchedList.Get(i);

        return finiteOrThrow( fPrinc );
    }
}

// --- financial.cxx: XIRR helper functions ----------------------------------------------------------

/** Calculates the resulting amount for the passed interest rate and the given XIRR parameters. */
function lcl_sca_XirrResult( rValues: ScaDoubleList, rDates: ScaDoubleList, fRate: number ): number
{
    /*  V_0 ... V_n = input values.
        D_0 ... D_n = input dates.
        R           = input interest rate.

        r   := R+1
        E_i := (D_i-D_0) / 365

                    n    V_i                n    V_i
        f(R)  =  SUM   -------  =  V_0 + SUM   ------- .
                   i=0  r^E_i              i=1  r^E_i
    */
    const V_ = ( i: number ) => rValues.Get(i);
    const D_ = ( i: number ) => rDates.Get(i);
    const D_0 = D_(0);
    const r = fRate + 1.0;
    let fResult = V_(0);
    for( let i = 1, nCount = rValues.Count(); i < nCount; ++i )
        fResult += V_(i) / Math.pow( r, (D_(i) - D_0) / 365.0 );
    return fResult;
}

/** Calculates the first derivation of lcl_sca_XirrResult(). */
function lcl_sca_XirrResult_Deriv1( rValues: ScaDoubleList, rDates: ScaDoubleList, fRate: number ): number
{
    /*  V_0 ... V_n = input values.
        D_0 ... D_n = input dates.
        R           = input interest rate.

        r   := R+1
        E_i := (D_i-D_0) / 365

                             n    V_i
        f'(R)  =  [ V_0 + SUM   ------- ]'
                            i=1  r^E_i

                         n           V_i                 n    E_i V_i
               =  0 + SUM   -E_i ----------- r'  =  - SUM   ----------- .
                        i=1       r^(E_i+1)             i=1  r^(E_i+1)
    */
    const V_ = ( i: number ) => rValues.Get(i);
    const D_ = ( i: number ) => rDates.Get(i);
    const D_0 = D_(0);
    const r = fRate + 1.0;
    let fResult = 0.0;
    for( let i = 1, nCount = rValues.Count(); i < nCount; ++i )
    {
        const E_i = (D_(i) - D_0) / 365.0;
        fResult -= E_i * V_(i) / Math.pow( r, E_i + 1.0 );
    }
    return fResult;
}
