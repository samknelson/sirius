<?php

class Sirius_Smf_Report_Edi_Delta extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-delta';

  public function benefit_nid() { return $this->benefit_nid_from_id('D'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Delta'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_delta.inc',
      'row_encoding' => 'json',
      'edi_carrier_name' => 'DELTA',
      'edi_group_number' => '17975',
      'edi_tiers' => array('blended', 'no_coverage'),
      'edi_output_format' => 'fixed',
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }
    if ($this->coverage_end_date($context)) { return 'no_coverage'; }
    return 'blended';
  }

  public function edi_has_premium() { return TRUE; }

  public function edi_has_header() { return TRUE; }

  public function edi_render_header($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $parameters = $parameters['parameters'];

    $header = array_keys($this->edi_fields('header'));

    $row['Record Type'] = '10';
    $row['Group ID'] = '17975';
    $row['Division ID'] = ''; 
    $row['Reporting Date'] = date('Ymd', strtotime($parameters['asof_date']));
    $row['File Type'] = $parameters['mode'];
    $row['Report Set ID'] = '';
    $row['File create date'] = date('Ymd', strtotime($parameters['report_date']));
    $row['File create time'] = '';
    $row['Filler'] = '';

    return array('header' => $header, 'rows' => array($row));
  }

  public function edi_has_footer() { return TRUE; }

  public function edi_render_footer($report_id, $output = 'page') {
    $info = $this->info();
    $parameters = $this->parameters($report_id);
    $rowcount = $this->rowcount($report_id);

    $row['Record Type'] = '90';
    $row['Record Count'] = $this->rowcount($report_id) + 2;
    $row['Filler'] = '';

    $header = array_keys($this->edi_fields('footer'));

    return array('header' => $header, 'rows' => array($row));
  }
  
  public function edi_fields($which = '') {
    $fields = array();

    if ($which == 'header') {
      $fields['Record Type'] = array('width' => 2);
      $fields['Group ID'] = array('width' => 5);
      $fields['Division ID'] = array('width' => 5);
      $fields['Reporting Date'] = array('width' => 8);
      $fields['File Type'] = array('width' => 1);
      $fields['Report Set ID'] = array('width' => 12);
      $fields['File create date'] = array('width' => 8);
      $fields['File create time'] = array('width' => 6);
      $fields['Filler'] = array('width' => 1953);
    } else if ($which != 'footer') {
      $fields['Record Type'] = array('width' => 2);
      $fields['Group ID'] = array('width' => 5);
      $fields['Division ID'] = array('width' => 5);
      $fields['Employer Reference ID'] = array('width' => 12);
      $fields['Employment Class'] = array('width' => 4);
      $fields['Incentive Start Date'] = array('width' => 8);
      $fields['Waiting Period Start Date'] = array('width' => 8);
      $fields['Primary Subscriber ID'] = array('width' => 16);
      $fields['Subscriber Alternate ID'] = array('width' => 16);
      $fields['Case ID'] = array('width' => 16);
      $fields['Member SSN'] = array('width' => 9);
      $fields['Member Last Name'] = array('width' => 35);
      $fields['Member First Name'] = array('width' => 25);
      $fields['Member Middle Name'] = array('width' => 25);
      $fields['Member Name Suffix'] = array('width' => 10);
      $fields['Gender'] = array('width' => 1);
      $fields['Date of Birth'] = array('width' => 8);
      $fields['Ethnicity Code'] = array('width' => 4);
      $fields['Language Code'] = array('width' => 2);
      $fields['Medicare Indicator'] = array('width' => 1);
      $fields['Member Classification'] = array('width' => 4);
      $fields['Business Level 4'] = array('width' => 12);
      $fields['Business Level 5'] = array('width' => 12);
      $fields['Business Level 6'] = array('width' => 12);
      $fields['Business Level 7'] = array('width' => 12);
      $fields['Benefit Package ID'] = array('width' => 8);
      $fields['Benefit Package Effective Date'] = array('width' => 8);
      $fields['Benefit Package Termination Date'] = array('width' => 8);
      $fields['Eligibility Effective Date'] = array('width' => 8);
      $fields['Eligibility Termination Date'] = array('width' => 8);
      $fields['Mailing Address 1'] = array('width' => 55);
      $fields['Mailing Address 2'] = array('width' => 55);
      $fields['Mailing Address 3'] = array('width' => 55);
      $fields['Mailing Address City'] = array('width' => 30);
      $fields['Mailing Address State'] = array('width' => 2);
      $fields['Mailing Address Zip Code'] = array('width' => 15);
      $fields['Mailing Address Country'] = array('width' => 3);
      $fields['Service Area'] = array('width' => 2);
      $fields['Residence Address 1'] = array('width' => 55);
      $fields['Residence Address 2'] = array('width' => 55);
      $fields['Residence Address 3'] = array('width' => 55);
      $fields['Residence Address City'] = array('width' => 30);
      $fields['Residence Address State'] = array('width' => 2);
      $fields['Residence Address Zip Code'] = array('width' => 15);
      $fields['Residence Address Country'] = array('width' => 3);
      $fields['Member Home Phone'] = array('width' => 14);
      $fields['Member Work Phone'] = array('width' => 14);
      $fields['Member Work Phone Extension'] = array('width' => 5);
      $fields['Member Cell Phone'] = array('width' => 14);
      $fields['Member Email Address'] = array('width' => 64);
      $fields['Contact Last Name'] = array('width' => 35);
      $fields['Contact First Name'] = array('width' => 25);
      $fields['Contact Middle Name'] = array('width' => 25);
      $fields['Contact Name Suffix'] = array('width' => 10);
      $fields['Contact Address 1'] = array('width' => 55);
      $fields['Contact Address 2'] = array('width' => 55);
      $fields['Contact Address 3'] = array('width' => 55);
      $fields['Contact City'] = array('width' => 30);
      $fields['Contact State'] = array('width' => 2);
      $fields['Contact Zip Code'] = array('width' => 15);
      $fields['Contact Country'] = array('width' => 3);
      $fields['Contact Phone'] = array('width' => 14);
      $fields['Contact Phone Extension'] = array('width' => 5);
      $fields['Contact Email Address'] = array('width' => 64);
      $fields['Provider Practice Location ID'] = array('width' => 12);
      $fields['MPNA Effective Date'] = array('width' => 8);
      $fields['MPNA Termination Date'] = array('width' => 8);
      $fields['Provider Termination Reason Code'] = array('width' => 4);
      $fields['Network ID'] = array('width' => 12);
      $fields['NPI'] = array('width' => 10);
      $fields['COB Other Carrier Name'] = array('width' => 50);
      $fields['COB Other Carrier Group/Policy #'] = array('width' => 12);
      $fields['COB Other Carrier  Address 1'] = array('width' => 55);
      $fields['COB Other Carrier  Address 2'] = array('width' => 55);
      $fields['COB Other Carrier  City'] = array('width' => 30);
      $fields['COB Other Carrier  State'] = array('width' => 2);
      $fields['COB Other Carrier  Zip Code'] = array('width' => 15);
      $fields['COB Other Carrier Subscriber Last Name'] = array('width' => 35);
      $fields['COB Other Carrier Subscriber First Name'] = array('width' => 25);
      $fields['COB Other Carrier Subscriber ID'] = array('width' => 12);
      $fields['Other Carrier Subscriber DOB'] = array('width' => 8);
      $fields['COB Effective Date'] = array('width' => 8);
      $fields['COB Termination Date'] = array('width' => 8);
      $fields['834 Action Codes'] = array('width' => 3);
      $fields['Group Reporting Data 1'] = array('width' => 50);
      $fields['Group Reporting Data 2'] = array('width' => 146);
      $fields['Reserved'] = array('width' => 192);
    } else {
      $fields['Record Type'] = array('width' => 2);
      $fields['Record Count'] = array('width' => 7);
      $fields['Filler'] = array('width' => 1991);
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

    return $form;
  }

  public function batch($workers, $values, &$batch_context) {
    $benefit_nid = $this->benefit_nid();

    $asof_date = date('Y-m-d 00:00:00', strtotime($values['parameters']['asof_date']));

    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }
      $this->qmsco_context($context);

      $row = array();

      $row['Record Type'] = '30';
      $row['Group ID'] = '17975';
      $row['Division ID'] = $this->division_id($context);
      $row['Employer Reference ID'] = '';
      $row['Employment Class'] = '';
      $row['Incentive Start Date'] = '';
      $row['Waiting Period Start Date'] = '';
      $row['Primary Subscriber ID'] = $this->ssn($context, 'subscriber_node');
      $row['Subscriber Alternate ID'] = '';
      $row['Case ID'] = '';
      $row['Member SSN'] = $this->ssn($context, 'worker_node');
      $row['Member Last Name'] = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['Member First Name'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['Member Middle Name'] = $context['worker_node']->field_sirius_name['und'][0]['middle'];
      $row['Member Name Suffix'] = '';
      $row['Gender'] = $this->gender($context);
      $row['Date of Birth'] = $this->dob($context, 'worker_node');
      $row['Ethnicity Code'] = '';
      $row['Language Code'] = '';
      $row['Medicare Indicator'] = '';
      $row['Member Classification'] = $this->member_classification($context);
      $row['Business Level 4'] = '';
      $row['Business Level 5'] = '';
      $row['Business Level 6'] = '';
      $row['Business Level 7'] = '';
      $row['Benefit Package ID'] = '';
      $row['Benefit Package Effective Date'] = '';
      $row['Benefit Package Termination Date'] = '';
      $row['Eligibility Effective Date'] = $this->coverage_start_date($context);
      $row['Eligibility Termination Date'] = $this->coverage_end_date($context);
      $row['Mailing Address 1'] = $context['worker_node']->field_sirius_address['und'][0]['thoroughfare'];
      $row['Mailing Address 2'] = $context['worker_node']->field_sirius_address['und'][0]['premise'];
      $row['Mailing Address 3'] = '';
      $row['Mailing Address City'] = $context['worker_node']->field_sirius_address['und'][0]['locality'];
      $row['Mailing Address State'] = $context['worker_node']->field_sirius_address['und'][0]['administrative_area'];
      $row['Mailing Address Zip Code'] = $this->zip($context, 'worker_node');
      $row['Mailing Address Country'] = '';
      $row['Service Area'] = '';
      $row['Residence Address 1'] = '';
      $row['Residence Address 2'] = '';
      $row['Residence Address 3'] = '';
      $row['Residence Address City'] = '';
      $row['Residence Address State'] = '';
      $row['Residence Address Zip Code'] = '';
      $row['Residence Address Country'] = '';
      $row['Member Home Phone'] = $this->phone($context, 'worker_node');
      $row['Member Work Phone'] = '';
      $row['Member Work Phone Extension'] = '';
      $row['Member Cell Phone'] = '';
      $row['Member Email Address'] =  $this->email($context, 'worker_node');
      $row['Contact Last Name'] = $context['qmsco_rp_worker_node']->field_sirius_name['und'][0]['family'];
      $row['Contact First Name'] = $context['qmsco_rp_worker_node']->field_sirius_name['und'][0]['given'];
      $row['Contact Middle Name'] = $context['qmsco_rp_worker_node']->field_sirius_name['und'][0]['middle'];
      $row['Contact Name Suffix'] = '';
      $row['Contact Address 1'] = $context['qmsco_rp_worker_node']->field_sirius_address['und'][0]['thoroughfare'];
      $row['Contact Address 2'] = $context['qmsco_rp_worker_node']->field_sirius_address['und'][0]['premise'];
      $row['Contact Address 3'] = '';
      $row['Contact City'] = $context['qmsco_rp_worker_node']->field_sirius_address['und'][0]['city'];
      $row['Contact State'] = $context['qmsco_rp_worker_node']->field_sirius_address['und'][0]['state'];
      $row['Contact Zip Code'] = $this->zip($context, 'qmsco_rp_worker_node');
      $row['Contact Country'] = $context['qmsco_rp_worker_node']->field_sirius_address['und'][0]['country'];
      $row['Contact Phone'] = $this->phone($context, 'qmsco_rp_worker_node');
      $row['Contact Phone Extension'] = '';
      $row['Contact Email Address'] = $this->email($context, 'qmsco_rp_worker_node');
      $row['Provider Practice Location ID'] = '';
      $row['MPNA Effective Date'] = '';
      $row['MPNA Termination Date'] = '';
      $row['Provider Termination Reason Code'] = '';
      $row['Network ID'] = '';
      $row['NPI'] = '';
      $row['COB Other Carrier Name'] = '';
      $row['COB Other Carrier Group/Policy #'] = '';
      $row['COB Other Carrier  Address 1'] = '';
      $row['COB Other Carrier  Address 2'] = '';
      $row['COB Other Carrier  City'] = '';
      $row['COB Other Carrier  State'] = '';
      $row['COB Other Carrier  Zip Code'] = '';
      $row['COB Other Carrier Subscriber Last Name'] = '';
      $row['COB Other Carrier Subscriber First Name'] = '';
      $row['COB Other Carrier Subscriber ID'] = '';
      $row['Other Carrier Subscriber DOB'] = '';
      $row['COB Effective Date'] = '';
      $row['COB Termination Date'] = '';
      $row['834 Action Codes'] = '';
      $row['Group Reporting Data 1'] = '';
      $row['Group Reporting Data 2'] = '';
      $row['Reserved'] = '';

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  public function member_classification($context) {
    $reltype_id = $this->relationship_type($context['relationship_node']);

    if (!$reltype_id) { return '10'; }
    if (in_array($reltype_id, array('C', 'AC', 'SC'))) { return '30'; }
    if (in_array($reltype_id, array('SP'))) { return '20'; }
    if (in_array($reltype_id, array('DP'))) { return '21'; }
    if (in_array($reltype_id, array('H'))) { return '32'; }
    if (in_array($reltype_id, array('G'))) { return '40'; }
    if (in_array($reltype_id, array('QMSCO'))) { return '13'; }
    return '';
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'M') { return 'M'; }
    if ($id == 'F') { return 'F'; }
    return 'U';
  }

  public function division_id($context) {
    if ($this->is_cobra($context)) { return '09002'; }
    return '00002'; 
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