<?php

class Sirius_Smf_Report_Edi_ExpressScripts extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-expressscripts';

  public function benefit_nid() { return $this->benefit_nid_from_id('EXPRESSSCRIPTS'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Express Scripts'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_expressscripts.inc',
      'row_encoding' => 'json',
      'edi_tiers' => array('blended'),
      'edi_output_format' => 'fixed',
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }
    return 'blended';
  }

  public function edi_has_header() { return TRUE; }

  public function edi_render_header($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $parameters = $parameters['parameters'];

    $row['Record Type'] = 'H';
    $row['Client ID'] = 'K7GA';
    $row['Client Name'] = 'UNITE HERE Local 11 Health Benefit Fund';
    $row['Processing Date'] = date('Ymd', strtotime($parameters['asof_date']));
    $row['File Creation Date'] = date('Ymd', strtotime($parameters['report_date']));
    $row['File Number'] = '00000000';
    $row['Production/Test indicator'] = $parameters['mode'];
    $row['Feed Source Desc'] = 'TPA';
    $row['Feed Source ID'] = 'K7G01';
    $row['Batch Type'] = 'N';
    $row['Term Date'] = '';
    $row['Bypass Record Count'] = '';
    $row['File Type Indicator'] = 'P';
    $row['Filler1'] = '';
    $row['ETS Process Key'] = '';
    $row['Filler2'] = '';
    $row['PDP Indicator'] = '';
    $row['Filler3'] = '';

    $header = array_keys($this->edi_fields('header'));

    return array('header' => $header, 'rows' => array($row));
  }

  public function edi_has_footer() { return TRUE; }

  public function edi_render_footer($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $rowcount = $this->rowcount($report_id);

    $row['Record Type'] = 'T';
    $row['Client ID'] = 'K7GA';
    $row['Record Count'] = $this->rowcount($report_id) + 2;
    $row['Filler1'] = '';
    $row['Reserved /PDP Indicator'] = '';
    $row['Filler2'] = '';

    $header = array_keys($this->edi_fields('footer'));

    return array('header' => $header, 'rows' => array($row));
  }
  public function edi_fields($which = '') {
    $fields = array();

    if ($which == 'header') {
      $fields['Record Type'] = array('width' => 1);
      $fields['Client ID'] = array('width' => 3);
      $fields['Client Name'] = array('width' => 60);
      $fields['Processing Date'] = array('width' => 8);
      $fields['File Creation Date'] = array('width' => 8);
      $fields['File Number'] = array('width' => 8);
      $fields['Production/Test indicator'] = array('width' => 1);
      $fields['Feed Source Desc'] = array('width' => 18);
      $fields['Feed Source ID'] = array('width' => 5);
      $fields['Batch Type'] = array('width' => 1);
      $fields['Term Date'] = array('width' => 8);
      $fields['Bypass Record Count'] = array('width' => 8);
      $fields['File Type Indicator'] = array('width' => 1);
      $fields['Filler1'] = array('width' => 14);
      $fields['ETS Process Key'] = array('width' => 22);
      $fields['Filler2'] = array('width' => 634);
      $fields['PDP Indicator'] = array('width' => 1);
      $fields['Filler3'] = array('width' => 699);
    } else if ($which == 'footer') {
      $fields['Record Type'] = array('width' => 1);
      $fields['Client ID'] = array('width' => 3);
      $fields['Record Count'] = array('width' => 7);
      $fields['Filler1'] = array('width' => 789);
      $fields['Reserved /PDP Indicator'] = array('width' => 1);
      $fields['Filler2'] = array('width' => 699);
    } else {
      $fields['Record Type'] = array('width' => 1);
      $fields['Client Identifier'] = array('width' => 3);
      $fields['Participant ID #1'] = array('width' => 18);
      $fields['Participant ID #2'] = array('width' => 18);
      $fields['Participant Effective Date'] = array('width' => 8);
      $fields['Participant First Name'] = array('width' => 12);
      $fields['Participant Last Name'] = array('width' => 18);
      $fields['Participant Middle Initial'] = array('width' => 1);
      $fields['Address #1'] = array('width' => 30);
      $fields['Address #2'] = array('width' => 30);
      $fields['Address #3'] = array('width' => 30);
      $fields['Address #4'] = array('width' => 30);
      $fields['City'] = array('width' => 28);
      $fields['State'] = array('width' => 2);
      $fields['Zip Code'] = array('width' => 5);
      $fields['Zip Reserve'] = array('width' => 4);
      $fields['Date of Birth'] = array('width' => 8);
      $fields['Gender Code'] = array('width' => 1);
      $fields['Contract or Family ID'] = array('width' => 18);
      $fields['Dependent ID'] = array('width' => 5);
      $fields['Relationship Code'] = array('width' => 1);
      $fields['Client Group ID'] = array('width' => 18);
      $fields['PCP ID'] = array('width' => 18);
      $fields['Reserved1'] = array('width' => 8);
      $fields['Filler1'] = array('width' => 18);
      $fields['Reserved2'] = array('width' => 8);
      $fields['Transaction Date'] = array('width' => 8);
      $fields['Participant Expiration Date'] = array('width' => 8);
      $fields['Insurance Code'] = array('width' => 20);
      $fields['Reserved3'] = array('width' => 1);
      $fields['Reserved4'] = array('width' => 7);
      $fields['Filler2'] = array('width' => 1);
      $fields['Medicare ID'] = array('width' => 12);
      $fields['Reserved5'] = array('width' => 1);
      $fields['Reserved6'] = array('width' => 7);
      $fields['Copay Waiver Flag'] = array('width' => 1);
      $fields['Coverage Code Status'] = array('width' => 1);
      $fields['Print ID Card Flag'] = array('width' => 1);
      $fields['Admin Hold Eff Date'] = array('width' => 8);
      $fields['Admin Hold Exp Date'] = array('width' => 8);
      $fields['COB Indicator/ Primary Carrier Flag'] = array('width' => 1);
      $fields['Client Specific Data'] = array('width' => 62);
      $fields['Reserved7'] = array('width' => 1);
      $fields['Member Level Address Type'] = array('width' => 1);
      $fields['Hospice Indicator'] = array('width' => 1);
      $fields['Suspense Indicator'] = array('width' => 1);
      $fields['COB Effective date'] = array('width' => 8);
      $fields['Contract Type'] = array('width' => 2);
      $fields['Member SSN'] = array('width' => 9);
      $fields['Subsidy/ESRD'] = array('width' => 1);
      $fields['Phone Number'] = array('width' => 10);
      $fields['Demographic Level 1'] = array('width' => 20);
      $fields['Demographic Level 2'] = array('width' => 20);
      $fields['Demographic Level 3'] = array('width' => 20);
      $fields['Demographic Level 4'] = array('width' => 20);
      $fields['Demographic Level 5'] = array('width' => 20);
      $fields['Demographic Level 6'] = array('width' => 20);
      $fields['Participant ID #3'] = array('width' => 18);
      $fields['Participant ID #4'] = array('width' => 18);
      $fields['County Code'] = array('width' => 3);
      $fields['Subsidy Eff Date'] = array('width' => 8);
      $fields['Subsidy Exp Date'] = array('width' => 8);
      $fields['Application ID'] = array('width' => 10);
      $fields['Benefit Option ID'] = array('width' => 20);
      $fields['Filler3'] = array('width' => 14);
      $fields['Multi-Birth Indicator'] = array('width' => 1);
      $fields['Client Specific 2'] = array('width' => 54);
      $fields['Record Sequence No.'] = array('width' => 4);
      $fields['PDP Indicator'] = array('width' => 1);
      $fields['Secondary-Drug-Insurance-Flag'] = array('width' => 1);
      $fields['Secondary-Rx-Group'] = array('width' => 15);
      $fields['Secondary-Rx-ID'] = array('width' => 20);
      $fields['Election Type'] = array('width' => 1);
      $fields['Part D Premium-Amt'] = array('width' => 6);
      $fields['Premium-Withhold-Option-C-D'] = array('width' => 1);
      $fields['Disenrollment-Indicator'] = array('width' => 1);
      $fields['Filler4'] = array('width' => 87);
      $fields['Last Name Expanded'] = array('width' => 35);
      $fields['First Name Expanded'] = array('width' => 25);
      $fields['Middle Initial Expanded'] = array('width' => 1);
      $fields['Address Line1 Expanded'] = array('width' => 55);
      $fields['Address Line2 Expanded'] = array('width' => 55);
      $fields['Address Line3 Expanded'] = array('width' => 55);
      $fields['Address City Expanded'] = array('width' => 30);
      $fields['Address State Expanded'] = array('width' => 2);
      $fields['Address Zip5 Expanded'] = array('width' => 5);
      $fields['Address Zip4 Expanded'] = array('width' => 4);
      $fields['Address Country Code Expanded'] = array('width' => 3);
      $fields['Primary Phone'] = array('width' => 10);
      $fields['Primary Phone Country Calling Code - Reserved for future.'] = array('width' => 3);
      $fields['Primary Phone Extension - Reserved for future.'] = array('width' => 6);
      $fields['Primary Phone Type'] = array('width' => 1);
      $fields['Communication Preference'] = array('width' => 1);
      $fields['Filler5'] = array('width' => 9);
      $fields['Alternate Phone'] = array('width' => 10);
      $fields['Alternate Phone Country Calling Code - Reserved for future.'] = array('width' => 3);
      $fields['Alternate Phone Extension - Reserved for future.'] = array('width' => 6);
      $fields['Alternate Phone Type'] = array('width' => 1);
      $fields['Filler6'] = array('width' => 1);
      $fields['Primary Email'] = array('width' => 80);
      $fields['Primary Email Type – Reserved for Future'] = array('width' => 1);
      $fields['Alternate Email – Reserved for Future'] = array('width' => 80);
      $fields['Alternate Email Type – Reserved for Future'] = array('width' => 1);
      $fields['Preferred Contact Method – Reserved for Future'] = array('width' => 1);
      $fields['Preferred  Language -'] = array('width' => 3);
      $fields['Time Zone'] = array('width' => 5);
      $fields['Filler7'] = array('width' => 3);
      $fields['HCR Plan Indicator'] = array('width' => 1);
      $fields['Grace Period Logic Effective Date'] = array('width' => 8);
      $fields['Ethnicity Indicator'] = array('width' => 1);
      $fields['Filler8'] = array('width' => 62);
    }

    return $fields;
  }

  public function form() {
    $form = parent::form();

    $form['mode'] = array(
      '#type' => 'select',
      '#title' => t('Mode'),
      '#options' => array(
        'P' => 'P -- Production Data',
        'T' => 'T -- Test Data',
      ),
      '#description' => t('This will appear in the header row as "production / test indicator"'),
    );

    $form['qmsco'] = array(
      '#type' => 'select',
      '#title' => t('QMSCO'),
      '#options' => array(
        'exclude' => t('Exclude QMSCO'),
        'include' => t('Include QMSCO Only'),
      ),
    );

    return $form;
  }

  public function batch($workers, $values, &$batch_context) {
    $benefit_nid = $this->benefit_nid();

    $asof_date = date('Y-m-d 00:00:00', strtotime($values['parameters']['asof_date']));
    $is_qmsco_only = ($values['parameters']['qmsco'] == 'include');

    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }

      // Separate feeds, one without qmsco and one with only qmsco.
      $is_qmsco = $this->is_qmsco($context);
      if ($is_qmsco && !$is_qmsco_only) { continue; }
      if (!$is_qmsco && $is_qmsco_only) { continue; }

      $row = array();

      $row['Record Type'] = 'M';
      $row['Client Identifier'] = 'K7GA';
      $row['Participant ID #1'] = '';
      $row['Participant ID #2'] = '';
      $row['Participant Effective Date'] = $this->coverage_start_date($context);
      $row['Participant First Name'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['Participant Last Name'] =  $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['Participant Middle Initial'] = substr($context['worker_node']->field_sirius_name['und'][0]['middle'], 0, 1);
      $row['Address #1'] = $context['worker_node']->field_sirius_address['und'][0]['thoroughfare'];
      $row['Address #2'] = $context['worker_node']->field_sirius_address['und'][0]['premise'];
      $row['Address #3'] = '';
      $row['Address #4'] = '';
      $row['City'] =  $context['worker_node']->field_sirius_address['und'][0]['locality'];
      $row['State'] =  $context['worker_node']->field_sirius_address['und'][0]['administrative_area'];
      $row['Zip Code'] = $this->zip($context, 'worker_node');
      $row['Zip Reserve'] = '';
      $row['Date of Birth'] = $this->dob($context, 'worker_node');
      $row['Gender Code'] = $this->gender($context);
      $row['Contract or Family ID'] = $this->ssn($context, 'subscriber_node');
      $row['Dependent ID'] = '';
      $row['Relationship Code'] = $this->relationship_code($context);
      $row['Client Group ID'] = $this->client_group_id($context);
      $row['PCP ID'] = '';
      $row['Reserved1'] = '';
      $row['Filler1'] = '';
      $row['Reserved2'] = '';
      $row['Transaction Date'] = '';
      $row['Participant Expiration Date'] = $this->coverage_end_date($context);
      $row['Insurance Code'] = '';
      $row['Reserved3'] = '';
      $row['Reserved4'] = '';
      $row['Filler2'] = '';
      $row['Medicare ID'] = '';
      $row['Reserved5'] = '';
      $row['Reserved6'] = '';
      $row['Copay Waiver Flag'] = '';
      $row['Coverage Code Status'] = '';
      $row['Print ID Card Flag'] = '';
      $row['Admin Hold Eff Date'] = '';
      $row['Admin Hold Exp Date'] = '';
      $row['COB Indicator/ Primary Carrier Flag'] = '';
      $row['Client Specific Data'] = '';
      $row['Reserved7'] = '';
      $row['Member Level Address Type'] = $this->member_level_address_type($context);
      $row['Hospice Indicator'] = '';
      $row['Suspense Indicator'] = '';
      $row['COB Effective date'] = '';
      $row['Contract Type'] = $this->contract_type($context);
      $row['Member SSN'] = $this->ssn($context, 'worker_node');
      $row['Subsidy/ESRD'] = '';
      $row['Phone Number'] = '';
      $row['Demographic Level 1'] = '';
      $row['Demographic Level 2'] = '';
      $row['Demographic Level 3'] = '';
      $row['Demographic Level 4'] = '';
      $row['Demographic Level 5'] = '';
      $row['Demographic Level 6'] = '';
      $row['Participant ID #3'] = '';
      $row['Participant ID #4'] = '';
      $row['County Code'] = '';
      $row['Subsidy Eff Date'] = '';
      $row['Subsidy Exp Date'] = '';
      $row['Application ID'] = '';
      $row['Benefit Option ID'] = '';
      $row['Filler3'] = '';
      $row['Multi-Birth Indicator'] = '';
      $row['Client Specific 2'] = '';
      $row['Record Sequence No.'] = '';
      $row['PDP Indicator'] = '';
      $row['Secondary-Drug-Insurance-Flag'] = '';
      $row['Secondary-Rx-Group'] = '';
      $row['Secondary-Rx-ID'] = '';
      $row['Election Type'] = 'S';
      $row['Part D Premium-Amt'] = '';
      $row['Premium-Withhold-Option-C-D'] = '';
      $row['Disenrollment-Indicator'] = '';
      $row['Filler4'] = '';
      $row['Last Name Expanded'] = '';
      $row['First Name Expanded'] = '';
      $row['Middle Initial Expanded'] = '';
      $row['Address Line1 Expanded'] = '';
      $row['Address Line2 Expanded'] = '';
      $row['Address Line3 Expanded'] = '';
      $row['Address City Expanded'] = '';
      $row['Address State Expanded'] = '';
      $row['Address Zip5 Expanded'] = '';
      $row['Address Zip4 Expanded'] = '';
      $row['Address Country Code Expanded'] = '';
      $row['Primary Phone'] = $this->phone($context, 'worker_node');
      $row['Primary Phone Country Calling Code - Reserved for future.'] = '';
      $row['Primary Phone Extension - Reserved for future.'] = '';
      $row['Primary Phone Type'] = '';
      $row['Communication Preference'] = '';
      $row['Filler5'] = '';
      $row['Alternate Phone'] = '';
      $row['Alternate Phone Country Calling Code - Reserved for future.'] = '';
      $row['Alternate Phone Extension - Reserved for future.'] = '';
      $row['Alternate Phone Type'] = '';
      $row['Filler6'] = '';
      $row['Primary Email'] = $this->email($context, 'worker_node');
      $row['Primary Email Type – Reserved for Future'] = '';
      $row['Alternate Email – Reserved for Future'] = '';
      $row['Alternate Email Type – Reserved for Future'] = '';
      $row['Preferred Contact Method – Reserved for Future'] = '';
      $row['Preferred  Language -'] = '';
      $row['Time Zone'] = '';
      $row['Filler7'] = '';
      $row['HCR Plan Indicator'] = '';
      $row['Grace Period Logic Effective Date'] = '';
      $row['Ethnicity Indicator'] = '';
      $row['Filler8'] = '';

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  /**
   * The spec is below, but doesn't map terribly well to our settings. We don't have "Student" or
   * "Adult Dependent", and I'm not sure if "Domestic Partner" = "Significant Other". Doing the best I can.
   * 
    1 = Contract Holder (1=PDP ONLY)
    2 = Spouse
    3 = Dependent
    4 = Student
    5 = Disabled Dependent
    6 = Adult Dependent
    7 = Significant Other
    8 = Unspecified
  */

  public function relationship_code($context) {
    $reltype_id = $this->relationship_type($context['relationship_node']);
    if (!$reltype_id) { return 1; }
    if (in_array($reltype_id, array('SP'))) { return '2'; }
    if (in_array($reltype_id, array('H'))) { return '5'; }
    if (in_array($reltype_id, array('DP'))) { return '7'; }
    return '3';
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'M') { return 'M'; }
    if ($id == 'F') { return 'F'; }
    return 'U';
  }

  public function contract_type($context) {
    if ($this->is_cobra($context)) { return 'CB'; }
    return 'AC'; 
  }

  /*
    IF  MedicalPlan = 'MLK' ⇒ Client Group ID = 'SMM00'
    ELSE IF  MedicalPlan = 'HealthNet' ⇒ Client Group ID = 'SMH00'
    ELSE IF  MedicalPlan = 'Kaiser' ⇒ Client Group ID = 'SMK00'
  */

  public function client_group_id($context) {
    $medical_coverage_id = $this->medical_coverage_id($context);
    if (in_array($medical_coverage_id, array('M')))       { return 'SMM00'; }
    if (in_array($medical_coverage_id, array('H')))       { return 'SMH00'; }
    if (in_array($medical_coverage_id, array('K', 'KE'))) { return 'SMK00'; }
    return ''; 
  }

  public function member_level_address_type($context) {
    if ($this->is_qmsco($context)) { return 'C'; }
  }
}

