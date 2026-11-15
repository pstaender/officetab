// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/inc/analysis.hrc faithful
// The en-US source strings of the Analysis add-in's functions (NC_ and its translation context
// dropped: the port has no translations): per function the description, then the name and the
// description of each parameter.

export const ANALYSIS_Workday: readonly string[] = [
  'Returns the serial number of the date before or after a specified number of workdays',
  'Start date',
  'The start date',
  'Days',
  'The number of workdays before or after the start date',
  'Holidays',
  'List of date values of days off (vacation, holidays, etc.)',
];

export const ANALYSIS_Yearfrac: readonly string[] = [
  'Returns the number of years (including fractional part) between two dates',
  'Start date',
  'The start date',
  'End date',
  'The end date',
  'Basis',
  'Basis indicates the day-count convention to use in the calculation',
];

export const ANALYSIS_Edate: readonly string[] = [
  'Returns the serial number of the date that is a specified number of months before or after the start date',
  'Start date',
  'The start date',
  'Months',
  'Number of months before or after the start date',
];

export const ANALYSIS_Weeknum: readonly string[] = [
  'Returns the number of the calendar week in which the specified date occurs.\nThis function exists for interoperability with older Microsoft Excel documents, for new documents use WEEKNUM instead.',
  'Date',
  'The date or date serial number',
  'Return type',
  'Indicates the first day of the week (1 = Sunday, 2 = Monday)',
];

export const ANALYSIS_Eomonth: readonly string[] = [
  'Returns the serial number of the last day of the month that comes a certain number of months before or after the start date',
  'Start date',
  'The start date',
  'Months',
  'Number of months before or after the start date',
];

export const ANALYSIS_Networkdays: readonly string[] = [
  'Returns the number of workdays between two dates.\nThis function exists for interoperability with older Microsoft Excel documents, for new documents use NETWORKDAYS instead.',
  'Start date',
  'The start date',
  'End date',
  'The end date',
  'Holidays',
  'List of date values representing days off (vacation, holidays, etc.)',
];

export const ANALYSIS_Iseven: readonly string[] = [
  'Returns the value \'true\' if the number truncated to integer is even',
  'Number',
  'The number',
];

export const ANALYSIS_Isodd: readonly string[] = [
  'Returns the value \'true\' if the number truncated to integer is odd',
  'Number',
  'The number',
];

export const ANALYSIS_Multinomial: readonly string[] = [
  'Returns the multinomial coefficient of a set of numbers',
  'Number',
  'Number or list of numbers for which you want the multinomial coefficient',
];

export const ANALYSIS_Seriessum: readonly string[] = [
  'Returns the sum of a power series',
  'X',
  'The independent variable of the power series',
  'N',
  'The initial power to which x is to be raised',
  'M',
  'The increment by which to increase n for each term in the series',
  'Coefficients',
  'Set of coefficients by which each successive power of the variable x is multiplied',
];

export const ANALYSIS_Quotient: readonly string[] = [
  'Returns the integer portion of a division',
  'Numerator',
  'The dividend',
  'Denominator',
  'The divisor',
];

export const ANALYSIS_Mround: readonly string[] = [
  'Returns a number rounded to a specified multiple',
  'Number',
  'The number to round off',
  'Multiple',
  'The multiple to which you want to round number',
];

export const ANALYSIS_Sqrtpi: readonly string[] = [
  'Returns the square root of a number which has been multiplied by pi',
  'Number',
  'The number by which pi is multiplied',
];

export const ANALYSIS_Randbetween: readonly string[] = [
  'Returns a random integer between the specified Bottom and Top values (both inclusive)',
  'Bottom',
  'The smallest integer that can be returned',
  'Top',
  'The largest integer that can be returned',
];

export const ANALYSIS_Gcd: readonly string[] = [
  'Returns the greatest common divisor.\nThis function exists for interoperability with older Microsoft Excel documents, for new documents use GCD instead.',
  'Number',
  'Number or list of numbers',
];

export const ANALYSIS_Lcm: readonly string[] = [
  'Returns the least common multiple.\nThis function exists for interoperability with older Microsoft Excel documents, for new documents use LCM instead.',
  'Number',
  'Number or list of numbers',
];

export const ANALYSIS_Besseli: readonly string[] = [
  'Returns the modified Bessel function In(x)',
  'X',
  'The value at which the function is to be evaluated',
  'N',
  'The order of the Bessel function',
];

export const ANALYSIS_Besselj: readonly string[] = [
  'Returns the Bessel function Jn(x)',
  'X',
  'The value at which the function is to be evaluated',
  'N',
  'The order of the Bessel function',
];

export const ANALYSIS_Besselk: readonly string[] = [
  'Returns the Bessel function Kn(x)',
  'X',
  'The value at which the function is to be evaluated',
  'N',
  'The order of the Bessel function',
];

export const ANALYSIS_Bessely: readonly string[] = [
  'Returns the Bessel function Yn(x)',
  'X',
  'The value at which the function is to be evaluated',
  'N',
  'The order of the Bessel function',
];

export const ANALYSIS_Bin2Oct: readonly string[] = [
  'Converts a binary number to an octal number',
  'Number',
  'The binary number to be converted (as text)',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Bin2Dec: readonly string[] = [
  'Converts a binary number to a decimal number',
  'Number',
  'The binary number to be converted (as text)',
];

export const ANALYSIS_Bin2Hex: readonly string[] = [
  'Converts a binary number to a hexadecimal number',
  'Number',
  'The binary number to be converted (as text)',
  'Places',
  'Number of places used.',
];

export const ANALYSIS_Oct2Bin: readonly string[] = [
  'Converts an octal number to a binary number',
  'Number',
  'The octal number to be converted (as text)',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Oct2Dec: readonly string[] = [
  'Converts an octal number to a decimal number',
  'Number',
  'The octal number to be converted (as text)',
];

export const ANALYSIS_Oct2Hex: readonly string[] = [
  'Converts an octal number to a hexadecimal number',
  'Number',
  'The octal number to be converted (as text)',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Dec2Bin: readonly string[] = [
  'Converts a decimal number to a binary number',
  'Number',
  'The decimal integer to be converted',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Dec2Hex: readonly string[] = [
  'Converts a decimal number to a hexadecimal number',
  'Number',
  'The decimal integer to be converted',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Dec2Oct: readonly string[] = [
  'Converts a decimal number into an octal number',
  'Number',
  'The decimal number',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Hex2Bin: readonly string[] = [
  'Converts a hexadecimal number to a binary number',
  'Number',
  'The hexadecimal number to be converted (as text)',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Hex2Dec: readonly string[] = [
  'Converts a hexadecimal number to a decimal number',
  'Number',
  'The hexadecimal number to be converted (as text)',
];

export const ANALYSIS_Hex2Oct: readonly string[] = [
  'Converts a hexadecimal number to an octal number',
  'Number',
  'The hexadecimal number to be converted (as text)',
  'Places',
  'Number of places used',
];

export const ANALYSIS_Delta: readonly string[] = [
  'Tests whether two values are equal',
  'Number 1',
  'The first number',
  'Number 2',
  'The second number',
];

export const ANALYSIS_Erf: readonly string[] = [
  'Returns the error function',
  'Lower limit',
  'The lower limit for integration',
  'Upper limit',
  'The upper limit for integration',
];

export const ANALYSIS_Erfc: readonly string[] = [
  'Returns the complementary error function',
  'Lower limit',
  'The lower limit for integration',
];

export const ANALYSIS_Gestep: readonly string[] = [
  'Tests whether a number is greater than a threshold value',
  'Number',
  'The value to test against step',
  'Step',
  'The threshold value',
];

export const ANALYSIS_Factdouble: readonly string[] = [
  'Returns the double factorial of Number',
  'Number',
  'The number',
];

export const ANALYSIS_Imabs: readonly string[] = [
  'Returns the absolute value (modulus) of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imaginary: readonly string[] = [
  'Returns the imaginary coefficient of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Impower: readonly string[] = [
  'Returns a complex number raised to a real power',
  'Complex number',
  'The complex number',
  'Number',
  'Power to which the complex number is raised',
];

export const ANALYSIS_Imargument: readonly string[] = [
  'Returns the argument theta, an angle expressed in radians',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imcos: readonly string[] = [
  'Returns the cosine of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imdiv: readonly string[] = [
  'Returns the quotient of two complex numbers',
  'Numerator',
  'The dividend',
  'Denominator',
  'The divisor',
];

export const ANALYSIS_Imexp: readonly string[] = [
  'Returns the algebraic form of the exponential of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imconjugate: readonly string[] = [
  'Returns the complex conjugate of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imln: readonly string[] = [
  'Returns the natural logarithm of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imlog10: readonly string[] = [
  'Returns the base-10 logarithm of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imlog2: readonly string[] = [
  'Returns the base-2 logarithm of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Improduct: readonly string[] = [
  'Returns the product of several complex numbers',
  'Complex number',
  'The first complex number',
  'Complex number',
  'Another complex number',
];

export const ANALYSIS_Imreal: readonly string[] = [
  'Returns the real coefficient of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imsin: readonly string[] = [
  'Returns the sine of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imsub: readonly string[] = [
  'Returns the difference of two complex numbers',
  'Complex number 1',
  'Complex number 1',
  'Complex number 2',
  'Complex number 2',
];

export const ANALYSIS_Imsqrt: readonly string[] = [
  'Returns the square root of a complex number',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imsum: readonly string[] = [
  'Returns the sum of complex numbers',
  'Complex number',
  'The complex number',
];

export const ANALYSIS_Imtan: readonly string[] = [
  'Returns the tangent of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imsec: readonly string[] = [
  'Returns the secant of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imcsc: readonly string[] = [
  'Returns the cosecant of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imcot: readonly string[] = [
  'Returns the cotangent of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imsinh: readonly string[] = [
  'Returns the hyperbolic sine of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imcosh: readonly string[] = [
  'Returns the hyperbolic cosine of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imsech: readonly string[] = [
  'Returns the hyperbolic secant of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Imcsch: readonly string[] = [
  'Returns the hyperbolic cosecant of a complex number',
  'Complex number',
  'A complex number',
];

export const ANALYSIS_Complex: readonly string[] = [
  'Converts real and imaginary coefficients into a complex number',
  'Real num',
  'The real coefficient',
  'I num',
  'The imaginary coefficient',
  'Suffix',
  'The suffix',
];

export const ANALYSIS_Convert: readonly string[] = [
  'Converts a number from one measurement system to another',
  'Number',
  'The number',
  'From unit',
  'Unit of measure for number',
  'To unit',
  'Unit of measure for the result',
];

export const ANALYSIS_Amordegrc: readonly string[] = [
  'Returns the prorated linear depreciation of an asset for each accounting period',
  'Cost',
  'Cost of the asset',
  'Date purchased',
  'Purchase date of the asset',
  'First period',
  'Date the first period ends',
  'Salvage',
  'Salvage value of an asset at the end of its life',
  'Period',
  'The period',
  'Rate',
  'The rate of depreciation',
  'Basis',
  'The year basis to be used',
];

export const ANALYSIS_Amorlinc: readonly string[] = [
  'Returns the prorated linear depreciation of an asset for each accounting period',
  'Cost',
  'Cost of the asset',
  'Date purchased',
  'Purchase date of the asset',
  'First period',
  'The date the first period ends',
  'Salvage',
  'The salvage value of an asset at the end of its life',
  'Period',
  'The period',
  'Rate',
  'The rate of depreciation',
  'Basis',
  'The year basis to be used',
];

export const ANALYSIS_Accrint: readonly string[] = [
  'Returns the accrued interest for a security that pays periodic interest',
  'Issue',
  'Issue date of the security',
  'First interest',
  'First interest date of the security',
  'Settlement',
  'The settlement',
  'Rate',
  'The rate',
  'Par',
  'The par value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Accrintm: readonly string[] = [
  'Returns the accrued interest for a security that pays interest at maturity',
  'Issue',
  'The issue date',
  'Settlement',
  'The settlement',
  'Rate',
  'The rate',
  'Par',
  'The par value',
  'Basis',
  'The basis',
];

export const ANALYSIS_Received: readonly string[] = [
  'Returns the amount paid out at maturity for a fully invested security',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Investment',
  'The investment',
  'Discount',
  'The discount',
  'Basis',
  'The basis',
];

export const ANALYSIS_Disc: readonly string[] = [
  'Returns the discount rate for a security',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Price',
  'The price',
  'Redemption',
  'The redemption value',
  'Basis',
  'The basis',
];

export const ANALYSIS_Duration: readonly string[] = [
  'Returns the annual Macaulay duration of a security with periodic interest payments',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Coupon',
  'The coupon rate',
  'Yield',
  'The yield',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Effect: readonly string[] = [
  'Returns the effective annual interest rate',
  'Nominal rate',
  'The nominal rate',
  'Npery',
  'The periods',
];

export const ANALYSIS_Cumprinc: readonly string[] = [
  'Returns the cumulative principal on a loan to be paid between two periods',
  'Rate',
  'The rate',
  'Nper',
  'Number of payment periods',
  'Pv',
  'The present value',
  'Start period',
  'The start period',
  'End period',
  'The end period',
  'Type',
  'The type of maturity',
];

export const ANALYSIS_Cumipmt: readonly string[] = [
  'Returns the cumulative interest to be paid between two periods',
  'Rate',
  'The rate',
  'Nper',
  'Number of payment periods',
  'Pv',
  'The present value',
  'Start period',
  'The start period',
  'End period',
  'The end period',
  'Type',
  'The type of maturity',
];

export const ANALYSIS_Price: readonly string[] = [
  'Returns the price per 100 currency units face value of a security that pays periodic interest',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Rate',
  'The rate',
  'Yield',
  'The yield',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Pricedisc: readonly string[] = [
  'Returns the price per 100 currency units face value of a discounted security',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Discount',
  'The discount',
  'Redemption',
  'The redemption value',
  'Basis',
  'The basis',
];

export const ANALYSIS_Pricemat: readonly string[] = [
  'Returns the price per 100 currency units face value of a security that pays interest at maturity',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Issue',
  'The issue date',
  'Rate',
  'The rate',
  'Yield',
  'The yield',
  'Basis',
  'The basis',
];

export const ANALYSIS_Mduration: readonly string[] = [
  'Returns the Macaulay modified duration for a security with an assumed par value of 100 currency units',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Coupon',
  'The coupon rate',
  'Yield',
  'The yield',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Nominal: readonly string[] = [
  'Returns the annual nominal interest rate',
  'Effective rate',
  'The effective interest rate',
  'Npery',
  'The periods',
];

export const ANALYSIS_Dollarfr: readonly string[] = [
  'Converts a price expressed as a decimal into a price expressed as a fraction',
  'Decimal dollar',
  'The decimal number',
  'Fraction',
  'The divisor',
];

export const ANALYSIS_Dollarde: readonly string[] = [
  'Converts a price expressed as a fraction into a price expressed as a decimal',
  'Fractional dollar',
  'The number as a fraction',
  'Fraction',
  'The divisor',
];

export const ANALYSIS_Yield: readonly string[] = [
  'Returns the yield on a security that pays periodic interest',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Rate',
  'The rate',
  'Price',
  'The price',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Yielddisc: readonly string[] = [
  'Returns the annual yield for a discounted security',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Price',
  'The price',
  'Redemption',
  'The redemption value',
  'Basis',
  'The basis',
];

export const ANALYSIS_Yieldmat: readonly string[] = [
  'Returns the annual yield of a security that pays interest at maturity',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Issue',
  'The issue date',
  'Rate',
  'The rate',
  'Price',
  'The price',
  'Basis',
  'The basis',
];

export const ANALYSIS_Tbilleq: readonly string[] = [
  'Returns the bond-equivalent yield for a treasury bill',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Discount',
  'The discount rate',
];

export const ANALYSIS_Tbillprice: readonly string[] = [
  'Returns the price of 100 currency units face value for a treasury bill',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Discount',
  'The discount rate',
];

export const ANALYSIS_Tbillyield: readonly string[] = [
  'Returns the yield for a treasury bill',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Price',
  'The price',
];

export const ANALYSIS_Oddfprice: readonly string[] = [
  'Returns the price per $100 face value of a security with an odd first period',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Issue',
  'The issue date',
  'First coupon',
  'The first coupon date',
  'Rate',
  'The rate',
  'Yield',
  'The yield',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Oddfyield: readonly string[] = [
  'Returns the yield of a security with an odd first period',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Issue',
  'The issue date',
  'First coupon',
  'The first coupon date',
  'Rate',
  'The rate',
  'Price',
  'The price',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Oddlprice: readonly string[] = [
  'Returns the price per $100 face value of a security with an odd last period',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Last interest',
  'The last interest date',
  'Rate',
  'The rate',
  'Yield',
  'The yield',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Oddlyield: readonly string[] = [
  'Returns the yield of a security with an odd last period',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Last interest',
  'The last interest date',
  'Rate',
  'The rate',
  'Price',
  'The price',
  'Redemption',
  'The redemption value',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Xirr: readonly string[] = [
  'Returns the internal rate of return for a non-periodic schedule of payments',
  'Values',
  'The values',
  'Dates',
  'The dates',
  'Guess',
  'The guess',
];

export const ANALYSIS_Xnpv: readonly string[] = [
  'Returns the net present value for a non-periodic schedule of payments',
  'Rate',
  'The rate',
  'Values',
  'The values',
  'Dates',
  'The dates',
];

export const ANALYSIS_Intrate: readonly string[] = [
  'Returns the interest rate for a fully invested security',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Investment',
  'The investment',
  'Redemption',
  'The redemption value',
  'Basis',
  'The basis',
];

export const ANALYSIS_Coupncd: readonly string[] = [
  'Returns the first coupon date after the settlement date',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Coupdays: readonly string[] = [
  'Returns the number of days in the coupon period containing the settlement date',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Coupdaysnc: readonly string[] = [
  'Returns the number of days from the settlement date to the next coupon date',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Coupdaybs: readonly string[] = [
  'Returns the number of days from the beginning of the coupon period to the settlement date',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Couppcd: readonly string[] = [
  'Returns the last coupon date preceding the settlement date',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Coupnum: readonly string[] = [
  'Returns the number of coupons payable between the settlement and maturity dates',
  'Settlement',
  'The settlement',
  'Maturity',
  'The maturity',
  'Frequency',
  'The frequency',
  'Basis',
  'The basis',
];

export const ANALYSIS_Fvschedule: readonly string[] = [
  'Returns the future value of the initial principal after a series of compound interest rates are applied',
  'Principal',
  'The principal',
  'Schedule',
  'The schedule',
];
