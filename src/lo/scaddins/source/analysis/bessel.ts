// SPDX-License-Identifier: MPL-2.0
// @upstream scaddins/source/analysis/bessel.cxx faithful
// @upstream scaddins/source/analysis/bessel.hxx faithful
// The BESSEL functions of the Analysis add-in.

import { IllegalArgumentException, NoConvergenceException } from '../../../sc/inc/addincol.ts';
import { isValidArcArg } from '../../../sal/rtl/math.ts';

const M_PI = Math.PI;
const M_2_PI = 2 / Math.PI;
const M_PI_2 = Math.PI / 2;
const M_PI_4 = Math.PI / 4;
const egamma = 0.5772156649015329; // std::numbers::egamma
/** C's fmod */
const fmod = (a: number, b: number): number => a % b;

// BESSEL J


/*  The BESSEL function, first kind, unmodified:
    The algorithm follows
    http://www.reference-global.com/isbn/978-3-11-020354-7
    Numerical Mathematics 1 / Numerische Mathematik 1,
    An algorithm-based introduction / Eine algorithmisch orientierte Einfuehrung
    Deuflhard, Peter; Hohmann, Andreas
    Berlin, New York (Walter de Gruyter) 2008
    4. ueberarb. u. erw. Aufl. 2008
    eBook ISBN: 978-3-11-020355-4
    Chapter 6.3.2 , algorithm 6.24
    The source is in German.
    The BesselJ-function is a special case of the adjoint summation with
    a_k = 2*(k-1)/x for k=1,...
    b_k = -1, for all k, directly substituted
    m_0=1, m_k=2 for k even, and m_k=0 for k odd, calculated on the fly
    alpha_k=1 for k=N and alpha_k=0 otherwise
*/

/** Returns the result for the unmodified BESSEL function of first kind (J), n-th order, at point x.

    @throws css::lang::IllegalArgumentException
    @throws css::sheet::NoConvergenceException
*/
export function BesselJ( x: number, N: number ): number

{
    if( N < 0 )
        throw new IllegalArgumentException();
    if (x===0.0)
        return (N===0) ? 1.0 : 0.0;

    /*  The algorithm works only for x>0, therefore remember sign. BesselJ
        with integer order N is an even function for even N (means J(-x)=J(x))
        and an odd function for odd N (means J(-x)=-J(x)).*/
    const fSign = (N % 2 === 1 && x < 0) ? -1.0 : 1.0;
    const fX = Math.abs(x);

    const fMaxIteration = 9000000.0; //experimental, for to return in < 3 seconds
    const fEstimateIteration = fX * 1.5 + N;
    const bAsymptoticPossible = Math.pow(fX,0.4) > N;
    if (fEstimateIteration > fMaxIteration)
    {
        if (!bAsymptoticPossible)
            throw new NoConvergenceException();
        return fSign * Math.sqrt(M_2_PI/fX)* Math.cos(fX-N*M_PI_2-M_PI_4);
    }

    const epsilon = 1.0e-15; // relative error
    let bHasfound = false;
    let k= 0.0;
    // e_{-1} = 0; e_0 = alpha_0 / b_2
    let u: number; // u_0 = e_0/f_0 = alpha_0/m_0 = alpha_0

    // first used with k=1
    let m_bar: number;         // m_bar_k = m_k * f_bar_{k-1}
    let g_bar: number;         // g_bar_k = m_bar_k - a_{k+1} + g_{k-1}
    let g_bar_delta_u: number; // g_bar_delta_u_k = f_bar_{k-1} * alpha_k
                               // - g_{k-1} * delta_u_{k-1} - m_bar_k * u_{k-1}
    // f_{-1} = 0.0; f_0 = m_0 / b_2 = 1/(-1) = -1
    let g = 0.0;       // g_0= f_{-1} / f_0 = 0/(-1) = 0
    let delta_u = 0.0; // dummy initialize, first used with * 0
    let f_bar = -1.0;  // f_bar_k = 1/f_k, but only used for k=0

    if (N===0)
    {
        //k=0; alpha_0 = 1.0
        u = 1.0; // u_0 = alpha_0
        // k = 1.0; at least one step is necessary
        // m_bar_k = m_k * f_bar_{k-1} ==> m_bar_1 = 0.0
        g_bar_delta_u = 0.0;    // alpha_k = 0.0, m_bar = 0.0; g= 0.0
        g_bar = - 2.0/fX;       // k = 1.0, g = 0.0
        delta_u = g_bar_delta_u / g_bar;
        u = u + delta_u ;       // u_k = u_{k-1} + delta_u_k
        g = -1.0 / g_bar;       // g_k=b_{k+2}/g_bar_k
        f_bar = f_bar * g;      // f_bar_k = f_bar_{k-1}* g_k
        k = 2.0;
        // From now on all alpha_k = 0.0 and k > N+1
    }
    else
    {   // N >= 1 and alpha_k = 0.0 for k<N
        u=0.0; // u_0 = alpha_0
        for (k =1.0; k<= N-1; k = k + 1.0)
        {
            m_bar=2.0 * fmod(k-1.0, 2.0) * f_bar;
            g_bar_delta_u = - g * delta_u - m_bar * u; // alpha_k = 0.0
            g_bar = m_bar - 2.0*k/fX + g;
            delta_u = g_bar_delta_u / g_bar;
            u = u + delta_u;
            g = -1.0/g_bar;
            f_bar=f_bar * g;
        }
        // Step alpha_N = 1.0
        m_bar=2.0 * fmod(k-1.0, 2.0) * f_bar;
        g_bar_delta_u = f_bar - g * delta_u - m_bar * u; // alpha_k = 1.0
        g_bar = m_bar - 2.0*k/fX + g;
        delta_u = g_bar_delta_u / g_bar;
        u = u + delta_u;
        g = -1.0/g_bar;
        f_bar = f_bar * g;
        k = k + 1.0;
    }
    // Loop until desired accuracy, always alpha_k = 0.0
    do
    {
        m_bar = 2.0 * fmod(k-1.0, 2.0) * f_bar;
        g_bar_delta_u = - g * delta_u - m_bar * u;
        g_bar = m_bar - 2.0*k/fX + g;
        delta_u = g_bar_delta_u / g_bar;
        u = u + delta_u;
        g = -1.0/g_bar;
        f_bar = f_bar * g;
        bHasfound = (Math.abs(delta_u)<=Math.abs(u)*epsilon);
        k = k + 1.0;
    }
    while (!bHasfound && k <= fMaxIteration);
    if (!bHasfound)
        throw new NoConvergenceException(); // unlikely to happen

    return u * fSign;
}


// BESSEL I


/*  The BESSEL function, first kind, modified:

                     inf                                  (x/2)^(n+2k)
        I_n(x)  =  SUM   TERM(n,k)   with   TERM(n,k) := --------------
                     k=0                                   k! (n+k)!

    No asymptotic approximation used, see issue 43040.
 */

/** Returns the result for the modified BESSEL function of first kind (I), n-th order, at point x.

    @throws css::lang::IllegalArgumentException
    @throws css::sheet::NoConvergenceException
*/
export function BesselI( x: number, n: number ): number
{
    const nMaxIteration = 2000;
    const fXHalf = x / 2.0;
    if( n < 0 )
        throw new IllegalArgumentException();

    let fResult = 0.0;

    /*  Start the iteration without TERM(n,0), which is set here.

            TERM(n,0) = (x/2)^n / n!
     */
    let nK = 0;
    let fTerm = 1.0;
    // avoid overflow in Fak(n)
    for( nK = 1; nK <= n; ++nK )
    {
        fTerm = fTerm / nK * fXHalf;
    }
    fResult = fTerm;    // Start result with TERM(n,0).
    if( fTerm !== 0.0 )
    {
        nK = 1;
        const fEpsilon = 1.0E-15;
        do
        {
            /*  Calculation of TERM(n,k) from TERM(n,k-1):

                                   (x/2)^(n+2k)
                    TERM(n,k)  =  --------------
                                    k! (n+k)!

                                   (x/2)^2 (x/2)^(n+2(k-1))
                               =  --------------------------
                                   k (k-1)! (n+k) (n+k-1)!

                                   (x/2)^2     (x/2)^(n+2(k-1))
                               =  --------- * ------------------
                                   k(n+k)      (k-1)! (n+k-1)!

                                   x^2/4
                               =  -------- TERM(n,k-1)
                                   k(n+k)
            */
            fTerm = fTerm * fXHalf / nK * fXHalf / (nK+n);
            fResult += fTerm;
            nK++;
        }
        while( (Math.abs( fTerm ) > Math.abs(fResult) * fEpsilon) && (nK < nMaxIteration) );

    }
    return fResult;
}

/// @throws IllegalArgumentException
/// @throws NoConvergenceException
function Besselk0( fNum: number ): number
{
    let fRet: number;

    if( fNum <= 2.0 )
    {
        const fNum2 = fNum * 0.5;
        const y = fNum2 * fNum2;

        fRet = -Math.log( fNum2 ) * BesselI( fNum, 0 ) +
                ( -0.57721566 + y * ( 0.42278420 + y * ( 0.23069756 + y * ( 0.3488590e-1 +
                    y * ( 0.262698e-2 + y * ( 0.10750e-3 + y * 0.74e-5 ) ) ) ) ) );
    }
    else
    {
        const y = 2.0 / fNum;

        fRet = Math.exp( -fNum ) / Math.sqrt( fNum ) * ( 1.25331414 + y * ( -0.7832358e-1 +
                y * ( 0.2189568e-1 + y * ( -0.1062446e-1 + y * ( 0.587872e-2 +
                y * ( -0.251540e-2 + y * 0.53208e-3 ) ) ) ) ) );
    }

    return fRet;
}

/// @throws IllegalArgumentException
/// @throws NoConvergenceException
function Besselk1( fNum: number ): number
{
    let fRet: number;

    if( fNum <= 2.0 )
    {
        const fNum2 = fNum * 0.5;
        const y = fNum2 * fNum2;

        fRet = Math.log( fNum2 ) * BesselI( fNum, 1 ) +
                ( 1.0 + y * ( 0.15443144 + y * ( -0.67278579 + y * ( -0.18156897 + y * ( -0.1919402e-1 +
                    y * ( -0.110404e-2 + y * -0.4686e-4 ) ) ) ) ) )
                / fNum;
    }
    else
    {
        const y = 2.0 / fNum;

        fRet = Math.exp( -fNum ) / Math.sqrt( fNum ) * ( 1.25331414 + y * ( 0.23498619 +
                y * ( -0.3655620e-1 + y * ( 0.1504268e-1 + y * ( -0.780353e-2 +
                y * ( 0.325614e-2 + y * -0.68245e-3 ) ) ) ) ) );
    }

    return fRet;
}


/** Returns the result for the modified BESSEL function of second kind (K), n-th order, at point x.

    @throws css::lang::IllegalArgumentException
    @throws css::sheet::NoConvergenceException
*/
export function BesselK( fNum: number, nOrder: number ): number
{
    switch( nOrder )
    {
        case 0:     return Besselk0( fNum );
        case 1:     return Besselk1( fNum );
        default:
        {
            const fTox = 2.0 / fNum;
            let fBkm = Besselk0( fNum );
            let fBk = Besselk1( fNum );

            for( let n = 1 ; n < nOrder ; n++ )
            {
                const fBkp = fBkm + n * fTox * fBk;
                fBkm = fBk;
                fBk = fBkp;
            }

            return fBk;
        }
    }
}


// BESSEL Y


/*  The BESSEL function, second kind, unmodified:
    The algorithm for order 0 and for order 1 follows
    http://www.reference-global.com/isbn/978-3-11-020354-7
    Numerical Mathematics 1 / Numerische Mathematik 1,
    An algorithm-based introduction / Eine algorithmisch orientierte Einfuehrung
    Deuflhard, Peter; Hohmann, Andreas
    Berlin, New York (Walter de Gruyter) 2008
    4. ueberarb. u. erw. Aufl. 2008
    eBook ISBN: 978-3-11-020355-4
    Chapter 6.3.2 , algorithm 6.24
    The source is in German.
    See #i31656# for a commented version of the implementation, attachment #desc6
    https://bz.apache.org/ooo/attachment.cgi?id=63609
*/

/// @throws IllegalArgumentException
/// @throws NoConvergenceException
function Bessely0( fX: number ): number
{
    // If fX > 2^64 then sin and cos fail
    if (fX <= 0 || !isValidArcArg(fX))
        throw new IllegalArgumentException();
    const fMaxIteration = 9000000.0; // should not be reached
    if (fX > 5.0e+6) // iteration is not considerable better then approximation
        return Math.sqrt(1/M_PI/fX)
                *(Math.sin(fX)-Math.cos(fX));
    const epsilon = 1.0e-15;
    let alpha = Math.log(fX/2.0)+egamma;
    let u = alpha;

    let k = 1.0;
    let g_bar_delta_u = 0.0;
    let g_bar = -2.0 / fX;
    let delta_u = g_bar_delta_u / g_bar;
    let g = -1.0/g_bar;
    let f_bar = -1 * g;

    let sign_alpha = 1.0;
    let bHasFound = false;
    k = k + 1;
    do
    {
        const km1mod2 = fmod(k-1.0, 2.0);
        const m_bar = (2.0*km1mod2) * f_bar;
        if (km1mod2 === 0.0)
            alpha = 0.0;
        else
        {
           alpha = sign_alpha * (4.0/k);
           sign_alpha = -sign_alpha;
        }
        g_bar_delta_u = f_bar * alpha - g * delta_u - m_bar * u;
        g_bar = m_bar - (2.0*k)/fX + g;
        delta_u = g_bar_delta_u / g_bar;
        u = u+delta_u;
        g = -1.0 / g_bar;
        f_bar = f_bar*g;
        bHasFound = (Math.abs(delta_u)<=Math.abs(u)*epsilon);
        k=k+1;
    }
    while (!bHasFound && k<fMaxIteration);
    if (!bHasFound)
        throw new NoConvergenceException(); // not likely to happen
    return u*M_2_PI;
}

// See #i31656# for a commented version of this implementation, attachment #desc6
// https://bz.apache.org/ooo/attachment.cgi?id=63609
/// @throws IllegalArgumentException
/// @throws NoConvergenceException
function Bessely1( fX: number ): number
{
    // If fX > 2^64 then sin and cos fail
    if (fX <= 0 || !isValidArcArg(fX))
        throw new IllegalArgumentException();
    const fMaxIteration = 9000000.0; // should not be reached
    if (fX > 5.0e+6) // iteration is not considerable better then approximation
        return - Math.sqrt(1/M_PI/fX)
                *(Math.sin(fX)+Math.cos(fX));
    const epsilon = 1.0e-15;
    let alpha = 1.0/fX;
    let f_bar = -1.0;
    let u = alpha;
    let k = 1.0;
    alpha = 1.0 - egamma - Math.log(fX/2.0);
    let g_bar_delta_u = -alpha;
    let g_bar = -2.0 / fX;
    let delta_u = g_bar_delta_u / g_bar;
    u = u + delta_u;
    let g = -1.0/g_bar;
    f_bar = f_bar * g;
    let sign_alpha = -1.0;
    let bHasFound = false;
    k = k + 1.0;
    do
    {
        const km1mod2 = fmod(k-1.0,2.0);
        const m_bar = (2.0*km1mod2) * f_bar;
        const q = (k-1.0)/2.0;
        if (km1mod2 === 0.0) // k is odd
        {
           alpha = sign_alpha * (1.0/q + 1.0/(q+1.0));
           sign_alpha = -sign_alpha;
        }
        else
            alpha = 0.0;
        g_bar_delta_u = f_bar * alpha - g * delta_u - m_bar * u;
        g_bar = m_bar - (2.0*k)/fX + g;
        delta_u = g_bar_delta_u / g_bar;
        u = u+delta_u;
        g = -1.0 / g_bar;
        f_bar = f_bar*g;
        bHasFound = (Math.abs(delta_u)<=Math.abs(u)*epsilon);
        k=k+1;
    }
    while (!bHasFound && k<fMaxIteration);
    if (!bHasFound)
        throw new NoConvergenceException();
    return -u*2.0/M_PI;
}

/** Returns the result for the unmodified BESSEL function of second kind (Y), n-th order, at point x.

    @throws css::lang::IllegalArgumentException
    @throws css::sheet::NoConvergenceException
*/
export function BesselY( fNum: number, nOrder: number ): number
{
    switch( nOrder )
    {
        case 0:     return Bessely0( fNum );
        case 1:     return Bessely1( fNum );
        default:
        {
            const fTox = 2.0 / fNum;
            let fBym = Bessely0( fNum );
            let fBy = Bessely1( fNum );

            for( let n = 1 ; n < nOrder ; n++ )
            {
                const fByp = n * fTox * fBy - fBym;
                fBym = fBy;
                fBy = fByp;
            }

            return fBy;
        }
    }
}
