<?php

class Sirius_Smf_Report_Edi_Healthnet extends Sirius_Trust_Provider_Edi_Report_Generator {
  public $type = 'sirius-smf-edi-healthnet';

  public function benefit_nid() { return $this->benefit_nid_from_id('H'); }

  public function info($result = array()) {
    $result = array(
      'name' => t('EDI - Healthnet'),
      'description' => '',
      'access' => 'sirius trust staff',
      'module' => 'sirius_smf',
      'file' => 'reports/edi_healthnet.inc',
      'row_encoding' => 'json',
      'edi_carrier_name' => 'HEALTHNET',
      'edi_group_number' => '',
      'edi_tiers' => array('blended'),
      'edi_tiers' => array('single', 'single+1', 'family'),
      'edi_group_number' => 'LB391A',
      'edi_output_format' => 'fixed',
    );

    return parent::info($result);
  }

  public function edi_premium_tier($context) {
    if (!($this->is_subscriber($context))) { return NULL; }

    $count = count($context['dependent_relationship_nodes']);
    if ($count == 0) { return 'single'; }
    if ($count == 1) { return 'single+1'; }
    return 'family';
  }

  public function edi_fields() {
    return array(
      'Health Net Group Number' => array('width' => 6),
      'Reserved 1' => array('width' => 2),
      'File Date' => array('width' => 8),
      'Transaction Type (Activity Flag)' => array('width' => 1),
      'Coverage Begin Date' => array('width' => 8),
      'Subscriber SSN' => array('width' => 9),
      'Dependent SSN' => array('width' => 9),
      'Member Type' => array('width' => 1),
      'Reserved 2' => array('width' => 3),
      'Last Name & Suffix' => array('width' => 17),
      'First Name' => array('width' => 10),
      'Middle Initial' => array('width' => 1),
      'Gender' => array('width' => 1),
      'Date of Birth' => array('width' => 8),
      'Address Line 1' => array('width' => 25),
      'Address Line 2' => array('width' => 25),
      'City' => array('width' => 17),
      'State' => array('width' => 2),
      'Zip Code' => array('width' => 5),
      'Zip Code +4 Extension' => array('width' => 4),
      'Work Telephone' => array('width' => 10),
      'Residence Telephone' => array('width' => 10),
      'Provider ID' => array('width' => 4),
      'Physician Last Name' => array('width' => 20),
      'Physician First Name' => array('width' => 20),
      'Physician Middle Initial' => array('width' => 1),
      '4-Digit PPG ID' => array('width' => 4),
      '6-Digit PCP ID' => array('width' => 6),
      'Current Patient Indicator' => array('width' => 1),
      'Hire Date' => array('width' => 8),
      'Employee Number' => array('width' => 6),
      'Department' => array('width' => 6),
      'COBRA End Date' => array('width' => 6),
      'Pay Status Code' => array('width' => 2),
      'Contract Type' => array('width' => 1),
      'Number Covered' => array('width' => 2),
      'Coverage End Date' => array('width' => 8),
      'Foreign Address Flag' => array('width' => 1),
      'Correspondence Indicator' => array('width' => 3),
      'Ethnicity Indicator' => array('width' => 3),
      'Student Indicator' => array('width' => 1),
      'Medicare Part A Indicator' => array('width' => 1),
      'Medicare Part B Indicator' => array('width' => 1),
      'Medicare Parts A & B Indicator' => array('width' => 1),
      'Medicare Part D Indicator' => array('width' => 1),
      'Disabled Indicator' => array('width' => 1),
      'Filler 1' => array('width' => 13),
      'Health Insurance Claim Number (for Medicare COB)' => array('width' => 13),
      'Coordination of Benefits' => array('width' => 1),
      'Insurance Line Code' => array('width' => 3),
      'Current Premium Amount' => array('width' => 8),
      'Retroactive Debit Amount' => array('width' => 8),
      'Retroactive Credit Amount' => array('width' => 8),
      'Record End Designator' => array('width' => 5),
    );
  }

  public function edi_has_premium() { return TRUE; }

  public function batch($workers, $values, &$batch_context) {
    $benefit_nid = $this->benefit_nid();

    $asof_date = date('Y-m-d 00:00:00', strtotime($values['parameters']['asof_date']));

    $rows = array();
    foreach ($workers as $worker_nid => $worker) {
      $wb_nid = $worker['wb_nid'];
      $context = $this->context($worker, $asof_date, $values['parameters']);
      if (!$context['worker_node']) { continue; }

      $row = array();

      $row['Health Net Group Number'] = $this->info()['edi_group_number'];
      $row['Reserved 1'] = '';
      $row['File Date'] = date('Ymd');
      $row['Transaction Type (Activity Flag)'] = '';
      $row['Coverage Begin Date'] = $this->coverage_start_date($context);
      $row['Subscriber SSN'] = $this->ssn($context, 'subscriber_node');
      $row['Dependent SSN'] = $this->ssn($context, 'worker_node');
      $row['Member Type'] = $this->member_type($context);
      $row['Reserved 2'] = '';
      $row['Last Name & Suffix'] = $context['worker_node']->field_sirius_name['und'][0]['family'];
      $row['First Name'] = $context['worker_node']->field_sirius_name['und'][0]['given'];
      $row['Middle Initial'] = substr($context['worker_node']->field_sirius_name['und'][0]['middle'], 0, 1);
      $row['Gender'] = $this->gender($context);
      $row['Date of Birth'] = $this->dob($context, 'worker_node');
      $row['Address Line 1'] = $context['worker_node']->field_sirius_address['und'][0]['thoroughfare'];
      $row['Address Line 2'] = $context['worker_node']->field_sirius_address['und'][0]['premise'];
      $row['City'] = $context['worker_node']->field_sirius_address['und'][0]['locality'];
      $row['State'] = $context['worker_node']->field_sirius_address['und'][0]['administrative_area'];
      $row['Zip Code'] = $this->zip($context, 'worker_node');
      $row['Zip Code +4 Extension'] = '';
      $row['Work Telephone'] = $this->phone($context, 'subscriber_node');
      $row['Residence Telephone'] = '';
      $row['Provider ID'] = '';
      $row['Physician Last Name'] = '';
      $row['Physician First Name'] = '';
      $row['Physician Middle Initial'] = '';
      $row['4-Digit PPG ID'] = '';
      $row['6-Digit PCP ID'] = '';
      $row['Current Patient Indicator'] = '';
      $row['Hire Date'] = $this->hire_date($context);
      $row['Employee Number'] = '';
      $row['Department'] = '';
      $row['COBRA End Date'] = '';
      $row['Pay Status Code'] = $this->pay_status_code($context);
      $row['Contract Type'] = $this->contract_type($context);
      $row['Number Covered'] = $this->number_covered($context);
      $row['Coverage End Date'] = $this->coverage_end_date($context);
      $row['Foreign Address Flag'] = '';
      $row['Correspondence Indicator'] = '';
      $row['Ethnicity Indicator'] = '';
      $row['Student Indicator'] = '';
      $row['Medicare Part A Indicator'] = '';
      $row['Medicare Part B Indicator'] = '';
      $row['Medicare Parts A & B Indicator'] = '';
      $row['Medicare Part D Indicator'] = '';
      $row['Disabled Indicator'] = '';
      $row['Filler 1'] = '';
      $row['Health Insurance Claim Number (for Medicare COB)'] = '';
      $row['Coordination of Benefits'] = '';
      $row['Insurance Line Code'] = 'HMO';
      $row['Current Premium Amount'] = '';
      $row['Retroactive Debit Amount'] = '';
      $row['Retroactive Credit Amount'] = '';
      $row['Record End Designator'] = 'HNPES';

      $row = $this->edi_row($row, $context);

      $rows[$context['pk']] = $row;
    }

    return array('is_multiple' => TRUE, 'rows' => $rows);
  }

  /**
   * "Relationship type:
      M = Self (subscriber)
      P = Domestic Partner
      D = Protected Person, Child, Adopted Child, QMSCO Child, Step Child, Handicapped Child
      S = Spouse
    */

  public function member_type($context) {
    if ($this->is_subscriber($context)) { return 'M'; }
    $reltype_tid = $context['relationship_node']->field_sirius_contact_reltype['und'][0]['tid'];
    if (!$reltype_tid) { return 'M'; }
    $reltype_term = taxonomy_term_load($reltype_tid);
    if (!$reltype_term) { return 'M'; }
    $reltype_id = $reltype_term->field_sirius_id['und'][0]['value'];
    if (!$reltype_id) { return 'M'; }

    if (in_array($reltype_id, array('DP'))) { return 'P'; }
    if (in_array($reltype_id, array('C', 'AC', 'H', 'SC', 'G'))) { return 'D'; }
    if (in_array($reltype_id, array('SP'))) { return 'S'; }
    if (in_array($reltype_id, array('QMSCO'))) { return 'Q'; }
  }

  public function gender($context) {
    $id = $this->gender_id($context['worker_node']);
    if ($id == 'F') { return 'F'; }
    if ($id == 'M') { return 'M'; }
    return 'F';
  }

  public function phone($context, $which) {
    if ($this->is_dependent($context)) { return ''; }
    return parent::phone($context, $which);
  }

  public function hire_date($context) {
    if ($this->is_dependent($context)) { return ''; }
    if (!$context['worker_node']) { return ''; }
    if (!$context['employer_node']) { return ''; }

    // drupal_set_message($context['worker_node']->title);
    $tss = array();

    // Can't be later than asof_ts
    $tss[] = $context['asof_ts'];

    // Get date of first hours
    $sql = 'select year, month '; 
    $sql .= 'from sirius_hours_cache ';
    $sql .= "where worker_nid = :worker_nid ";
    $sql .= "order by year, month ";
    $stmt = sirius_sql_query($sql, array(':worker_nid' => $context['worker_node']->nid));
    $hr = $stmt->fetchAssoc();
    if ($hr) {
      $tss[] = strtotime($hr['year'] . '-' . $hr['month'] . '-1');
    }

    // Can't be later than start date
    $date = $this->coverage_start_date($context);
    if ($date) { $tss[] = strtotime($date); }

    // Can't be later than start date
    $date = $this->coverage_end_date($context);
    if ($date) { $tss[] = strtotime($date); }

    $ts = min($tss);
    // foreach ($tss as $ts) { drupal_set_message(date('Ymd', $ts)); }
    // drupal_set_message("Min: " . date('Ymd', $ts));

    return date('Ymd', $ts);
  }

  public function pay_status_code($context) {
    if ($this->is_dependent($context)) { return ''; }
    if ($this->is_cobra($context)) { return 'CO'; } else { return 'AC'; }
  }

  public function number_covered($context) {
    if ($this->is_dependent($context)) { return ''; }

    return count($context['dependent_relationship_nodes']) + 1;
  }

  /*
  -Single: If coverage is for Member Only, then ContractType = 1
  -Two-Party: If coverage is for Member + One Dependent (regardless of whether the dependent is a spouse, child, or other), then ContractType = 2
  -Family: If coverage includes Member + More Than One Dependent, then ContractType = 3
  */

  public function contract_type($context) {
    if ($this->is_dependent($context)) { return ''; }

    $count = count($context['dependent_relationship_nodes']);

    if ($count == 0) { return '1'; }
    if ($count == 1) { return '2'; }
    return '3';
  }
}