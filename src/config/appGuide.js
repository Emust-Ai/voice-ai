// Wattzhub CPO App User Guide
// This is loaded only when users need help with the mobile app

export const APP_GUIDE = `
## Getting Started

### Downloading and Installing
Download the Wattzhub CPO app from:
- **Android**: Google Play Store
- **iOS**: Apple App Store
- Open the app after installation

### Creating an Account
To use Wattzhub CPO, you need to create an account:

1. Open the app and tap "Create Account" or "Sign Up"
2. Fill in the required information:
   - **First Name**: Your first name
   - **Last Name**: Your last name
   - **Email**: A valid email address (will be used for login)
   - **Password**: Create a secure password
   - **Confirm Password**: Re-enter your password
3. Accept the End User License Agreement (EULA)
4. Complete the captcha verification if prompted
5. Tap "Sign Up" to create your account
6. Check your email for verification (if required)

### Logging In
1. Open the app
2. Enter your registered email address
3. Enter your password
4. Accept the EULA if prompted
5. Tap "Login"

**Tip**: The app will remember your login credentials for future sessions.

### OTP Login
For enhanced security, you can use OTP (One-Time Password) login:

1. On the login screen, select "Login with OTP"
2. Enter your registered phone number
3. You will receive an SMS with a verification code
4. Enter the verification code in the app
5. You will be logged in automatically

### Password Recovery
If you forgot your password:

1. On the login screen, tap "Forgot Password?"
2. Enter your registered email address
3. You will receive an email with a reset link or code
4. Follow the instructions to create a new password
5. Return to the app and log in with your new password

---

## Navigation Overview

### Side Menu (Drawer)
Access the side menu by tapping the hamburger icon (☰) in the top left corner or swiping from the left edge. The side menu contains:

| Menu Item | Description |
|-----------|-------------|
| **Charging Stations** | Find and access charging stations |
| **Sites** | Browse charging sites (locations) |
| **Transactions In Progress** | View active charging sessions |
| **Transaction History** | View past charging sessions |
| **Statistics** | View your usage statistics |
| **My Badges** | Manage your RFID badges/tags |
| **My Cars** | Manage your registered vehicles |
| **Invoices** | View your payment invoices |
| **Wallet** | Manage your wallet balance |
| **Settings** | Configure app settings |
| **Support** | Get help and support |
| **Report Error** | Report issues with the app |
| **Logout** | Sign out of your account |

### Bottom Tabs
When viewing charging station details, you'll see bottom tabs for:
- **Connector Details**: Information about the selected connector
- **Properties**: Technical specifications
- **Actions**: Administrative actions (if authorized)
- **OCPP Parameters**: Technical parameters (for administrators)

---

## Finding Charging Stations

### Map View
The default view shows charging stations on an interactive map:

1. Navigate to "Charging Stations" from the side menu
2. The map displays charging stations as pins/markers
3. **Green markers**: Available stations
4. **Red/Orange markers**: Occupied or unavailable stations
5. Tap on a marker to see station details
6. Use pinch gestures to zoom in/out
7. The map will show your current location (if permissions are granted)

**Map Options:**
- Toggle between standard and satellite views using the map style button
- Tap the location button to center on your current position

### List View
Switch to list view for a different perspective:

1. Tap the list icon to switch from map to list view
2. Stations are displayed in a scrollable list
3. Each entry shows:
   - Station name
   - Address
   - Connector availability
   - Distance from your location
4. Tap on a station to view details

### Filtering Charging Stations
Refine your search using filters:

1. Tap the filter icon on the charging stations screen
2. Available filters include:
   - **Connector Type**: Filter by connector type (Type 2, CCS, CHAdeMO, etc.)
   - **Status**: Available, Occupied, Faulted
   - **Power Level**: Filter by charging speed
3. Apply filters to see matching stations

### Viewing Station Details
Tap on any charging station to view:
- **Station Name and Location**
- **Available Connectors**: With status indicators
- **Connector Types**: Type 2, CCS, CHAdeMO, etc.
- **Power Output**: kW rating
- **Tariff/Pricing**: Cost per kWh or time-based pricing
- **Current Status**: Available, Preparing, Charging, Unavailable, Faulted

---

## Starting a Charging Session

### Prerequisites
Before you can start a charging session, you must have:

1. ✅ **An active account** - You must be logged in
2. ✅ **A registered badge (RFID tag)** - You need at least one active badge
3. ✅ **A valid payment method** or **sufficient wallet balance**
4. ✅ **Your vehicle plugged in** - Connect your EV to the charger

⚠️ **Important**: If you're missing any of these requirements, the app will display an error and prevent you from starting a session.

### Step-by-Step Guide

**Step 1: Find a Charging Station**
1. Open the app and go to "Charging Stations"
2. Use the map or list to find a nearby station
3. Tap on the station to view details

**Step 2: Select a Connector**
1. View the available connectors at the station
2. Look for a connector with "Available" status (green)
3. Tap on the connector to open the connector details screen

**Step 3: Plug In Your Vehicle**
1. Physically connect your EV to the charging station connector
2. Make sure the connector is properly inserted
3. The connector status should change to "Preparing"

**Step 4: Start the Charging Session**
1. On the connector details screen, tap the large "Start" button (green)
2. If prompted, select:
   - **Your Badge**: Choose which RFID badge to use
   - **Your Car**: Select your registered vehicle (optional)
3. Confirm the start of the session
4. Wait for the session to begin (the button will show a loading indicator)

**Step 5: Monitor Your Session**
1. Once started, you'll see:
   - **Energy Consumed**: kWh delivered
   - **Duration**: Time elapsed
   - **Estimated Cost**: Running total
   - **State of Charge (SoC)**: If your vehicle reports it
2. The connector status changes to "Charging"

**Step 6: Stop the Charging Session**
1. When you're ready to stop, tap the "Stop" button (red)
2. Confirm that you want to stop the session
3. Wait for the session to end
4. Unplug your vehicle from the charger

### QR Code Scanning
You can also start a session by scanning a QR code:

1. Tap the QR code scanner icon (usually in the header)
2. Point your camera at the QR code on the charging station
3. The app will automatically detect the station and connector
4. Follow the same steps to start charging

**Note**: If the QR code belongs to a different organization, you may be prompted to switch accounts.

---

## Managing Transactions

### Transactions In Progress
View your active charging sessions:

1. Go to "Transactions In Progress" from the side menu
2. See all your currently active charging sessions
3. Each session shows:
   - Charging station name
   - Connector ID
   - Energy consumed
   - Duration
   - Cost (if pricing is active)
4. Tap on a transaction to view details and stop the session

### Transaction History
Review your past charging sessions:

1. Go to "Transaction History" from the side menu
2. Browse through your completed sessions
3. Use the search function to find specific transactions
4. Apply filters by:
   - Date range
   - User (if you have admin rights)
5. Each transaction shows:
   - Date and time
   - Station and connector
   - Energy consumed
   - Duration
   - Total cost

### Transaction Details
Tap on any transaction to see:
- **Full session summary**
- **Charging chart**: Visual representation of the charging curve
- **Energy breakdown**: kWh consumed
- **Time breakdown**: Total duration, charging time, idle time
- **Cost breakdown**: Per kWh, per minute, total

---

## Wallet Management

### Viewing Your Balance
1. Go to "Wallet" from the side menu
2. Your current balance is displayed at the top
3. Balance is shown in your local currency

### Adding Credit to Your Wallet
1. Open the Wallet screen
2. Tap "Add Credit" or the "+" button
3. Enter the amount you want to add
4. Select your payment method
5. You'll be redirected to the payment gateway
6. Complete the payment
7. Your wallet balance will be updated automatically

**Tip**: If a payment is interrupted, the app will detect pending payments and offer to verify them when you return.

### Transaction History in Wallet
View your wallet activity:

1. Scroll down on the Wallet screen
2. See all wallet operations:
   - **Purchased**: Credits added to your wallet
   - **Consumed**: Credits used for charging
3. Each entry shows:
   - Date and time
   - Amount
   - Transaction type
   - Previous balance

---

## Payment Methods

### Adding a Payment Method
1. Navigate to "Settings" → "Payment Methods"
   - Or access through the Wallet screen
2. Tap the "+" button to add a new payment method
3. Follow the prompts to add your card:
   - Enter card details
   - Complete verification if required
4. Your payment method will be saved for future use

### Managing Payment Methods
1. Go to the Payment Methods screen
2. View all your saved payment methods
3. **Set Default**: Tap to set a method as default
4. **Delete**: Swipe left on a payment method to delete it
5. **Add New**: Use the "+" button to add more methods

---

## Badges (RFID Tags)
Badges (also called Tags) are RFID cards used to authenticate at charging stations.

### Viewing Your Badges
1. Go to "My Badges" from the side menu
2. View all badges associated with your account
3. Each badge shows:
   - Badge ID/Name
   - Status (Active/Inactive)
   - Associated user
   - Creation date

### Using a Badge
When starting a charging session:

1. If you have multiple badges, you'll be asked to select one
2. Choose the badge you want to use for the session
3. The session will be associated with that badge

**Note**: Badges must be active to start a charging session. Contact support if your badge is inactive.

---

## Managing Your Vehicles

### Adding a Car
1. Go to "My Cars" from the side menu
2. Tap the "+" button to add a new car
3. Fill in the vehicle details:
   - Make/Manufacturer
   - Model
   - Year
   - License plate (optional)
   - Battery capacity (optional)
4. Save your vehicle

### Viewing Your Cars
1. Go to "My Cars" from the side menu
2. Browse your registered vehicles
3. Tap on a car to view or edit details
4. Delete a car by swiping left (if supported)

**Tip**: Adding your car helps the app estimate charging times and costs based on your vehicle's battery capacity.

---

## Sites and Site Areas
Sites are physical locations containing one or more charging stations.

### Browsing Sites
1. Go to "Sites" from the side menu
2. View sites on a map or list
3. Each site shows:
   - Site name
   - Address
   - Number of available chargers
   - Total chargers
4. Tap on a site to see its site areas

### Browsing Site Areas
Site areas are subdivisions within a site (e.g., Parking Level 1, Outdoor Area):

1. From a site, view its site areas
2. Each site area shows:
   - Area name
   - Available/total connectors
3. Tap on a site area to see charging stations in that area

---

## Statistics and Reports

### Viewing Your Statistics
1. Go to "Statistics" from the side menu
2. View your charging summary:
   - **Total Sessions**: Number of charging sessions
   - **Total Energy**: kWh consumed
   - **Total Duration**: Time spent charging
   - **Total Cost**: Amount spent on charging
3. Filter statistics by date range
4. View trends and patterns in your charging behavior

### Invoices
1. Go to "Invoices" from the side menu
2. View all your payment invoices
3. Each invoice shows:
   - Invoice ID
   - Date
   - Amount
   - Status (Paid, Pending)
4. Tap on an invoice to view details

---

## Settings
Access Settings from the side menu by tapping the gear icon or going to "Settings".

### Editing Your Profile
1. In Settings, tap on your profile section at the top
2. Edit your personal information:
   - First Name
   - Last Name
   - Email
3. Tap "Save" to update your profile

### Language Settings
1. Go to Settings → Language
2. Select your preferred language:
   - English
   - Persian (فارسی)
   - Arabic (العربية)
   - French (Français)
   - Spanish (Español)
   - German (Deutsch)
   - Portuguese (Português)
   - Italian (Italiano)
   - Czech (Čeština)
3. The app will restart to apply the language change

### Theme Settings
1. Go to Settings → Theme
2. Choose your preferred theme:
   - **Light**: Bright theme for daytime use
   - **Dark**: Dark theme for nighttime use
   - **System**: Follows your device's theme setting

### Distance Unit
1. Go to Settings → Distance Unit
2. Select your preferred unit:
   - **Automatic**: Based on your location
   - **Kilometers (km)**
   - **Miles (mi)**

---

## Support

### Getting Help
1. Go to "Support" from the side menu
2. Access help resources:
   - FAQ section
   - Contact information
   - Help articles

### Live Chat Support
1. On the Support screen, tap the chat bubble icon
2. The Chatwoot live chat widget will open
3. Type your message to connect with a support agent
4. Get real-time assistance for your issues

### Reporting Errors
If you encounter issues with the app:

1. Go to "Report Error" from the side menu
2. Describe the problem you're experiencing
3. Include relevant details:
   - What you were trying to do
   - What happened instead
   - Any error messages you saw
4. Submit your report
5. Our team will investigate and respond

---

## Troubleshooting

### Can't Start a Charging Session
**Problem**: The "Start" button is disabled or shows an error.

**Solutions**:
1. **Check your badge**: Ensure you have an active badge assigned to your account
2. **Check payment method**: Add a valid payment method or add credit to your wallet
3. **Check connector status**: The connector must be "Available" or "Preparing"
4. **Plug in your vehicle**: Make sure your EV is properly connected to the charger
5. **Check your account status**: Ensure your account is active and in good standing

### Session Won't Stop
**Problem**: Unable to stop an active charging session.

**Solutions**:
1. Try refreshing the app
2. Wait a moment and try again
3. Contact support if the issue persists
4. As a last resort, physically disconnect your vehicle (may result in connector lock issues)

### Map Not Loading
**Problem**: The charging stations map is not displaying.

**Solutions**:
1. Check your internet connection
2. Enable location permissions for the app
3. Restart the app
4. Clear app cache and try again

### Payment Failed
**Problem**: Wallet top-up or payment failed.

**Solutions**:
1. Check your internet connection
2. Verify your payment method is valid
3. Ensure sufficient funds in your bank account/card
4. Try a different payment method
5. Contact support if payments continue to fail

### App Crashes
**Problem**: The app unexpectedly closes.

**Solutions**:
1. Update the app to the latest version
2. Restart your device
3. Clear app cache
4. Reinstall the app if necessary
5. Report the issue through the "Report Error" feature

---

## FAQ

### General Questions

**Q: Is Wattzhub CPO free to use?**
A: The app is free to download and use. You only pay for the electricity you consume during charging sessions.

**Q: What payment methods are accepted?**
A: We accept major credit/debit cards and online payment through supported payment gateways. You can also prepay using the wallet feature.

**Q: Can I use the app without an account?**
A: No, you must create an account and log in to use the charging features. This ensures secure payment and session tracking.

### Charging Questions

**Q: How do I know which connector to use?**
A: Check your vehicle's charging port type and match it with available connectors. Common types include Type 2 (AC), CCS (DC fast), and CHAdeMO (DC fast).

**Q: What does the connector status mean?**
- **Available**: Ready for use
- **Preparing**: Waiting for vehicle connection
- **Charging**: Actively charging a vehicle
- **SuspendedEV**: Vehicle paused charging
- **Finishing**: Ending session
- **Unavailable**: Out of service
- **Faulted**: Technical error

**Q: Can I reserve a charging station?**
A: Currently, reservations are not supported. Stations are available on a first-come, first-served basis.

**Q: How long can I charge?**
A: Sessions have a maximum duration of 20 hours. Some locations may have additional time limits.

### Account Questions

**Q: How do I change my password?**
A: Use the "Forgot Password" feature on the login screen to reset your password via email.

**Q: Can I have multiple badges?**
A: Yes, you can have multiple badges associated with your account. You'll select which one to use when starting a session.

**Q: How do I delete my account?**
A: Contact support to request account deletion. Note that you must settle any outstanding balances first.

### Payment Questions

**Q: How is the charging cost calculated?**
A: Pricing varies by station and may include:
- Per kWh (energy consumed)
- Per minute (time-based)
- Flat session fee
- Combination of the above

**Q: What happens if my wallet balance runs out during charging?**
A: The session may be stopped if your balance is insufficient. Ensure adequate funds before starting.

**Q: Can I get a refund?**
A: Contact support for refund requests. Refunds are evaluated on a case-by-case basis.
`;

export default APP_GUIDE;
