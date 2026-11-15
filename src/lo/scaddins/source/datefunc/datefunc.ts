// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/source/datefunc/datefunc.cxx faithful
// @upstream scaddins/source/datefunc/datefunc.hxx faithful
// The DateFunctions add-in (com.sun.star.sheet.addin.DateFunctions): WEEKS, MONTHS, YEARS,
// ISLEAPYEAR, DAYSINMONTH, DAYSINYEAR, WEEKSINYEAR and ROT13.
// Port notes: no UNO. The class implements the port's ScAddInComponent: getMethods() gives the
// methods of XDateFunctions and XMiscFunctions (the IDL tables) with an invoke() that calls the
// method of the same name. Resources are the en-US strings (ScaResId returns the string).
// getDisplayFunctionName and the other XAddIn methods initialise the function data themselves
// when setLocale was not called first.

import { IllegalArgumentException, RuntimeException, ScAddInArgumentType, type LocalizedName, type ScAddInParamInfo, type ScAddInComponent, type ScAddInMethod, type UnoAny, type UnoDate, type UnoLocale, type XPropertySet } from '../../../sc/inc/addincol.ts';
import { XDateFunctions } from '../../idl/com/sun/star/sheet/addin/XDateFunctions.ts';
import { XMiscFunctions } from '../../idl/com/sun/star/sheet/addin/XMiscFunctions.ts';
import * as Descr from '../../inc/datefunc.ts';
import * as Names from '../../inc/strings.ts';
import * as DefNames from './deffuncname.ts';

type XOpt = XPropertySet | null | undefined;

export const ScaCategory = {
    DateTime: 0,
    Text: 1,
    Finance: 2,
    Inf: 3,
    Math: 4,
    Tech: 5,
} as const;
export type ScaCategory = (typeof ScaCategory)[keyof typeof ScaCategory];

export interface ScaFuncDataBase
{
    pIntName: string;               // internal name (get***)
    pUINameID: string;              // resource ID to UI name
    pDescrID: readonly string[];    // resource ID to description, parameter names and ~ description
    pCompListID: readonly string[]; // list of valid names
    nParamCount: number;            // number of named / described parameters
    eCat: ScaCategory;              // function category
    bDouble: boolean;               // name already exist in Calc
    bWithOpt: boolean;              // first parameter is internal
}

export class ScaFuncData
{
    private aIntName: string;           // internal name (get***)
    private pUINameID: string;          // resource ID to UI name
    private pDescrID: readonly string[];// leads also to parameter descriptions!
    private nParamCount: number;        // num of parameters
    private aCompList: string[] = [];   // list of all valid names
    private eCat: ScaCategory;          // function category
    private bDouble: boolean;           // name already exist in Calc
    private bWithOpt: boolean;          // first parameter is internal

    constructor( rBaseData: ScaFuncDataBase )
    {
        this.aIntName = rBaseData.pIntName;
        this.pUINameID = rBaseData.pUINameID;
        this.pDescrID = rBaseData.pDescrID;
        this.nParamCount = rBaseData.nParamCount;
        this.eCat = rBaseData.eCat;
        this.bDouble = rBaseData.bDouble;
        this.bWithOpt = rBaseData.bWithOpt;
        this.aCompList.push(rBaseData.pCompListID[0]!);
        this.aCompList.push(rBaseData.pCompListID[1]!);
    }

    GetUINameID(): string { return this.pUINameID; }
    GetDescrID(): readonly string[] { return this.pDescrID; }
    GetCategory(): ScaCategory { return this.eCat; }
    IsDouble(): boolean { return this.bDouble; }

    GetStrIndex( nParam: number ): number
    {
        if( !this.bWithOpt )
            nParam++;
        return (nParam > this.nParamCount) ? (this.nParamCount * 2) : (nParam * 2);
    }
    Is( rCompare: string ): boolean { return this.aIntName === rCompare; }

    GetCompNameList(): readonly string[] { return this.aCompList; }
}

export type ScaFuncDataList = ScaFuncData[];

/** Predicate for use with Array.prototype.find */
function FindScaFuncData( rId: string ): ( rCandidate: ScaFuncData ) => boolean
{
    return ( rCandidate ) => rCandidate.Is( rId );
}

const ADDIN_SERVICE = "com.sun.star.sheet.AddIn";
const MY_SERVICE = "com.sun.star.sheet.addin.DateFunctions";
const MY_IMPLNAME = "com.sun.star.sheet.addin.DateFunctionsImpl";

const UNIQUE = false;   // function name does not exist in Calc

const STDPAR = false;   // all parameters are described
const INTPAR = true;    // first parameter is internal

function FUNCDATA( FuncName: string, ParamCount: number, Category: ScaCategory, Double: boolean, IntPar: boolean ): ScaFuncDataBase
{
    return { pIntName: "get" + FuncName, pUINameID: (Names as Record<string, unknown>)['DATE_FUNCNAME_' + FuncName] as string,
        pDescrID: (Descr as Record<string, unknown>)['DATE_FUNCDESC_' + FuncName] as readonly string[],
        pCompListID: (DefNames as Record<string, unknown>)['DATE_DEFFUNCNAME_' + FuncName] as readonly string[],
        nParamCount: ParamCount, eCat: Category, bDouble: Double, bWithOpt: IntPar };
}

const pFuncDataArr: readonly ScaFuncDataBase[] =
[
    FUNCDATA( 'DiffWeeks',    3, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'DiffMonths',   3, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'DiffYears',    3, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'IsLeapYear',   1, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'DaysInMonth',  1, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'DaysInYear',   1, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'WeeksInYear',  1, ScaCategory.DateTime, UNIQUE, INTPAR ),
    FUNCDATA( 'Rot13',        1, ScaCategory.Text,     UNIQUE, STDPAR )
];

function InitScaFuncDataList( rList: ScaFuncDataList ): void
{
    for (const nIndex of pFuncDataArr)
        rList.push(new ScaFuncData(nIndex));
}

const pLang = [ "de", "en" ];
const pCoun = [ "DE", "US" ];
const nNumOfLoc = pLang.length;

// auxiliary functions
function IsLeapYear( nYear: number ): boolean
{
    return ((((nYear % 4) === 0) && ((nYear % 100) !== 0)) || ((nYear % 400) === 0));
}

const aDaysInMonth = [ 31, 28, 31, 30, 31, 30,
                       31, 31, 30, 31, 30, 31 ];

function DaysInMonth( nMonth: number, nYear: number ): number
{
    if ( nMonth !== 2 )
        return aDaysInMonth[nMonth-1]!;
    else
    {
        if ( IsLeapYear(nYear) )
            return aDaysInMonth[nMonth-1]! + 1;
        else
            return aDaysInMonth[nMonth-1]!;
    }
}

/**
 * Convert a date to a count of days starting from 01/01/0001
 *
 * The internal representation of a Date used in this Addin
 * is the number of days between 01/01/0001 and the date
 * this function converts a Day , Month, Year representation
 * to this internal Date value.
 */

function DateToDays( nDay: number, nMonth: number, nYear: number ): number
{
    let nDays = (nYear-1) * 365;
    nDays += Math.trunc((nYear-1) / 4) - Math.trunc((nYear-1) / 100) + Math.trunc((nYear-1) / 400);

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
 *
 * @throws lang::IllegalArgumentException
 */

function DaysToDate( nDays: number ): [number, number, number]
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
        rYear = (Math.trunc(nTempDays / 365) - i) & 0xFFFF;
        nTempDays -= (rYear -1) * 365;
        nTempDays -= Math.trunc(( rYear -1) / 4) - Math.trunc(( rYear -1) / 100) + Math.trunc((rYear -1) / 400);
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
    const rDay = nTempDays & 0xFFFF;
    return [ rDay, rMonth, rYear ];
}

/**
 * Get the null date used by the spreadsheet document
 *
 * The internal representation of a Date used in this Addin
 * is the number of days between 01/01/0001 and the date
 * this function returns this internal Date value for the document null date
 *
 * @throws uno::RuntimeException
 */
function GetNullDate( xOptions: XOpt ): number
{
    if (xOptions)
    {
        try
        {
            const aAny = xOptions.getPropertyValue( "NullDate" ) as UnoDate | undefined;
            if ( aAny && typeof aAny === 'object' && 'Day' in aAny )
                return DateToDays( aAny.Day, aAny.Month, aAny.Year );
        }
        catch
        {
        }
    }

    // no null date available -> no calculations possible
    throw new RuntimeException();
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

// THE AddIn class for date functions

export class ScaDateAddIn implements ScAddInComponent
{
    private aFuncLoc: UnoLocale = { Language: '', Country: '' };
    private pDefLocales: UnoLocale[] | null = null;
    private pFuncDataList: ScaFuncDataList | null = null;

    private InitDefLocales(): void
    {
        this.pDefLocales = [];

        for( let nIndex = 0; nIndex < nNumOfLoc; nIndex++ )
        {
            this.pDefLocales[ nIndex ] = { Language: pLang[ nIndex ]!, Country: pCoun[ nIndex ]! };
        }
    }

    private GetLocale( nIndex: number ): UnoLocale
    {
        if( !this.pDefLocales )
            this.InitDefLocales();

        return (nIndex < nNumOfLoc) ? this.pDefLocales![ nIndex ]! : this.aFuncLoc;
    }

    private InitData(): void
    {
        this.pFuncDataList = null;

        this.pFuncDataList = [];
        InitScaFuncDataList(this.pFuncDataList);

        if( this.pDefLocales )
        {
            this.pDefLocales = null;
        }
    }

    private find( aProgrammaticName: string ): ScaFuncData | undefined
    {
        if( !this.pFuncDataList )
            this.InitData();
        return this.pFuncDataList!.find( FindScaFuncData( aProgrammaticName ) );
    }

    private GetFuncDescrStr( pResId: readonly string[], nStrIndex: number ): string
    {
        return this.ScaResId(pResId[nStrIndex - 1]!);
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

    supportsService( aServiceName: string ): boolean
    {
        return this.getSupportedServiceNames().includes( aServiceName );
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

    getProgrammaticFuntionName( _aDisplayName: string ): string
    {
        //  not used by calc
        //  (but should be implemented for other uses of the AddIn service)
        return '';
    }

    getDisplayFunctionName( aProgrammaticName: string ): string
    {
        let aRet: string;

        const fDataIt = this.find( aProgrammaticName );
        if( fDataIt )
        {
            aRet = this.ScaResId(fDataIt.GetUINameID());
            if( fDataIt.IsDouble() )
                aRet += "_ADD";
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

        const fDataIt = this.find( aProgrammaticName );
        if( fDataIt )
            aRet = this.GetFuncDescrStr( fDataIt.GetDescrID(), 1 );

        return aRet;
    }

    getDisplayArgumentName( aProgrammaticName: string, nArgument: number ): string
    {
        let aRet = '';

        const fDataIt = this.find( aProgrammaticName );
        if( fDataIt && (nArgument <= 0xFFFF) )
        {
            const nStr = fDataIt.GetStrIndex( nArgument );
            if( nStr )
                aRet = this.GetFuncDescrStr( fDataIt.GetDescrID(), nStr );
            else
                aRet = "internal";
        }

        return aRet;
    }

    getArgumentDescription( aProgrammaticName: string, nArgument: number ): string
    {
        let aRet = '';

        const fDataIt = this.find( aProgrammaticName );
        if( fDataIt && (nArgument <= 0xFFFF) )
        {
            const nStr = fDataIt.GetStrIndex( nArgument );
            if( nStr )
                aRet = this.GetFuncDescrStr( fDataIt.GetDescrID(), nStr + 1 );
            else
                aRet = "for internal use only";
        }

        return aRet;
    }

    getProgrammaticCategoryName( aProgrammaticName: string ): string
    {
        let aRet = '';

        const fDataIt = this.find( aProgrammaticName );
        if( fDataIt )
        {
            switch( fDataIt.GetCategory() )
            {
                case ScaCategory.DateTime:   aRet = "Date&Time";    break;
                case ScaCategory.Text:       aRet = "Text";         break;
                case ScaCategory.Finance:    aRet = "Financial";    break;
                case ScaCategory.Inf:        aRet = "Information";  break;
                case ScaCategory.Math:       aRet = "Mathematical"; break;
                case ScaCategory.Tech:       aRet = "Technical";    break;
            }
        }

        if( !aRet )
            aRet = "Add-In";
        return aRet;
    }

    getDisplayCategoryName( aProgrammaticName: string ): string
    {
        return this.getProgrammaticCategoryName( aProgrammaticName );
    }

    // XCompatibilityNames
    getCompatibilityNames( aProgrammaticName: string ): LocalizedName[]
    {
        const fDataIt = this.find( aProgrammaticName );
        if( !fDataIt )
            return [];

        const rStrList = fDataIt.GetCompNameList();
        const nCount = rStrList.length;

        const aRet: LocalizedName[] = [];

        for( let nIndex = 0; nIndex < nCount; nIndex++ )
            aRet[ nIndex ] = { Locale: this.GetLocale( nIndex ), Name: rStrList[ nIndex ]! };

        return aRet;
    }

    /** The methods of XDateFunctions and XMiscFunctions, as UNO introspection gives them to
        ScUnoAddInCollection. */
    getMethods(): ScAddInMethod[]
    {
        return [ ...XDateFunctions, ...XMiscFunctions ].map( ( m ) => ( {
            getName: () => m.aName,
            getParameterInfos: () => [ ...m.aParams ],
            invoke: ( aArgs: unknown[] ) => ( this as unknown as Record<string, ( ...a: unknown[] ) => UnoAny> )[ m.aName ]!.apply( this, lcl_CheckArgs( m.aParams, [ ...aArgs ] ) ),
        } ) );
    }

    // XDateFunctions

    /**
     * Get week difference between 2 dates
     *
     * new Weeks(date1,date2,mode) function for StarCalc
     *
     * Two modes of operation are provided.
     * mode 0 is just a simple division by 7 calculation.
     *
     * mode 1 calculates the difference by week adhering to ISO8601.
     *
     * The International Standard IS-8601 states that Monday is the first
     * day of the week. The Gregorian Calendar is used for all dates,
     * proleptic in case of dates before 1582-10-15.
     *
     * The (consecutive) week number of a date is
     * std::floor( (date + NullDate - 1), 7.0 ),
     * with weeks starting on Monday, and week 0
     * starting on Monday, 0001-01-01 Gregorian.
     *
     * Weeks(d2,d1,m) is defined as -Weeks(d1,d2,m).
     *
     */

    getDiffWeeks( xOptions: XOpt, nStartDate: number, nEndDate: number, nMode: number ): number
    {
        if ( nMode  === 0 )
        {
            return Math.trunc( ( nEndDate - nStartDate ) / 7 );
        }
        else if ( nMode === 1 )
        {
            const nNullDate = GetNullDate( xOptions );
            const nDays1 = nStartDate + nNullDate - 1;
            const nDays2 = nEndDate + nNullDate - 1;

            return ( Math.floor( nDays2 / 7.0 ) - Math.floor( nDays1 / 7.0 ) );
        }
        else
            throw new IllegalArgumentException();
    }

    /**
     * Get month difference between 2 dates
     * =Month(start, end, mode) Function for StarCalc
     *
     * two modes are provided
     *
     * mode 0 is the interval between the dates in month
     *
     * mode 1 is the difference in calendar month
     */
    getDiffMonths( xOptions: XOpt, nStartDate: number, nEndDate: number, nMode: number ): number
    {
        if (nMode !== 0 && nMode !== 1)
            throw new IllegalArgumentException();

        const nNullDate = GetNullDate( xOptions );

        const nDays1 = nStartDate + nNullDate;
        const nDays2 = nEndDate + nNullDate;

        const [ nDay1, nMonth1, nYear1 ] = DaysToDate(nDays1);
        const [ nDay2, nMonth2, nYear2 ] = DaysToDate(nDays2);

        let nRet = nMonth2 - nMonth1 + (nYear2 - nYear1) * 12;
        if ( nMode === 1 || nDays1 === nDays2 ) return nRet;

        if ( nDays1 < nDays2 )
        {
            if ( nDay1 > nDay2 )
            {
                nRet -= 1;
            }
        }
        else
        {
            if ( nDay1 < nDay2 )
            {
                nRet += 1;
            }
        }

        return nRet;
    }

    /**
     * Get Year difference between 2 dates
     *
     * two modes are provided
     *
     * mode 0 is the interval between the dates in years
     *
     * mode 1 is the difference in calendar years
     */
    getDiffYears( xOptions: XOpt, nStartDate: number, nEndDate: number, nMode: number ): number
    {
        if (nMode !== 0 && nMode !== 1)
            throw new IllegalArgumentException();

        if ( nMode !== 1 )
            return Math.trunc( this.getDiffMonths( xOptions, nStartDate, nEndDate, nMode ) / 12 );

        const nNullDate = GetNullDate( xOptions );

        const nDays1 = nStartDate + nNullDate;
        const nDays2 = nEndDate + nNullDate;

        const [ , , nYear1 ] = DaysToDate(nDays1);
        const [ , , nYear2 ] = DaysToDate(nDays2);

        return nYear2 - nYear1;
    }

    /**
     * Check if a Date is in a leap year in the Gregorian calendar
     */
    getIsLeapYear( xOptions: XOpt, nDate: number ): number
    {
        const nNullDate = GetNullDate( xOptions );
        const nDays = nDate + nNullDate;

        const [ , , nYear ] = DaysToDate(nDays);

        return Number(IsLeapYear(nYear));
    }

    /**
     * Get the Number of Days in the month for a date
     */
    getDaysInMonth( xOptions: XOpt, nDate: number ): number
    {
        const nNullDate = GetNullDate( xOptions );
        const nDays = nDate + nNullDate;

        const [ , nMonth, nYear ] = DaysToDate(nDays);

        return DaysInMonth( nMonth, nYear );
    }

    /**
     * Get number of days in the year of a date specified
     */
    getDaysInYear( xOptions: XOpt, nDate: number ): number
    {
        const nNullDate = GetNullDate( xOptions );
        const nDays = nDate + nNullDate;

        const [ , , nYear ] = DaysToDate(nDays);

        return ( IsLeapYear(nYear) ? 366 : 365 );
    }

    /**
     * Get number of weeks in the year for a date
     *
     * Most years have 52 weeks, but years that start on a Thursday
     * and leap years that start on a Wednesday have 53 weeks
     *
     * The International Standard IS-8601 has decreed that Monday
     * shall be the first day of the week.
     *
     * A WeekDay can be calculated by subtracting 1 and calculating the rest of
     * a division by 7 from the internal date representation
     * which gives a 0 - 6 value for Monday - Sunday
     *
     * @see #IsLeapYear #WeekNumber
     */
    getWeeksInYear( xOptions: XOpt, nDate: number ): number
    {
        const nNullDate = GetNullDate( xOptions );
        const nDays = nDate + nNullDate;

        const [ , , nYear ] = DaysToDate(nDays);

        const nJan1WeekDay = ( DateToDays(1,1,nYear) - 1) % 7;

        let nRet: number;
        if ( nJan1WeekDay === 3 )        /* Thursday */
            nRet = 53;
        else if ( nJan1WeekDay === 2 )   /* Wednesday */
            nRet = ( IsLeapYear(nYear) ? 53 : 52 );
        else
            nRet = 52;

        return nRet;
    }

    // XMiscFunctions

    /**
     * Encrypt or decrypt a string using ROT13 algorithm
     *
     * This function rotates each character by 13 in the alphabet.
     * Only the characters 'a' ... 'z' and 'A' ... 'Z' are modified.
     */
    getRot13( aSrcString: string ): string
    {
        const aBuffer = Array.from( { length: aSrcString.length }, ( _, i ) => aSrcString.charCodeAt( i ) );
        for( let nIndex = 0; nIndex < aBuffer.length; nIndex++ )
        {
            let cChar = aBuffer[nIndex]!;
            if( (cChar >= 97) && (cChar <= 122))        // 'a' ... 'z'
            {
                cChar += 13;
                if (cChar > 122)
                    cChar -= 26;
            }
            else if( (cChar >= 65) && (cChar <= 90) )   // 'A' ... 'Z'
            {
                cChar += 13;
                if (cChar > 90)
                    cChar -= 26;
            }
            aBuffer[nIndex] = cChar;
        }
        return String.fromCharCode( ...aBuffer );
    }

    ScaResId( aId: string ): string
    {
        return aId;
    }
}
